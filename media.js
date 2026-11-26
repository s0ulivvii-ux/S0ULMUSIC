import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)
export const downloader = process.env.YTDLP_PATH || (existsSync('.venv/bin/yt-dlp') ? '.venv/bin/yt-dlp' : 'yt-dlp')
export const commonArgs = ['--ignore-config', '--no-warnings', '--socket-timeout', '12', '--retries', '1', '--js-runtimes', 'node']
const directHosts = ['youtube.com', 'youtu.be', 'soundcloud.com', 'bandcamp.com', 'vimeo.com', 'mixcloud.com', 'twitch.tv']
const hostIs = (host, suffix) => host === suffix || host.endsWith('.' + suffix)
const normalize = text => (text || '').normalize('NFKC').toLowerCase().replace(/\([^)]*(official|lyrics|visualizer)[^)]*\)|\[[^\]]*(official|lyrics|visualizer)[^\]]*\]/gi, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

async function lookup(query, flat = false) {
  const args = [...commonArgs, '--skip-download', '--dump-single-json', '--playlist-end', '50']
  if (flat) args.push('--flat-playlist')
  const { stdout } = await run(downloader, [...args, '--', query], { timeout: 45000, maxBuffer: 20 * 1024 * 1024 })
  return JSON.parse(stdout)
}

function trackFrom(data) {
  let url = data.webpage_url || data.url
  if (data.ie_key === 'Youtube' && /^[\w-]{11}$/.test(url || '')) url = 'https://www.youtube.com/watch?v=' + url
  if (!url || !/^https?:\/\//i.test(url) || !directHosts.some(h => hostIs(new URL(url).hostname, h))) return null
  return {
    needsDetails: data._type === 'url' || data._type === 'url_transparent',
    playUrl: url, info: { uri: url, title: data.track || data.title, author: data.artist || data.uploader || data.channel || '' },
    uploader: data.uploader || data.channel || '',
    duration: Number(data.duration) || 0,
    artistUrl: data.uploader_url || data.channel_url,
    artwork: data.thumbnail || data.thumbnails?.at(-1)?.url
  }
}

export async function fillTrackDetails(track) {
  if (!track.needsDetails || (track.info.title && track.artwork && track.info.author)) return
  track.needsDetails = false
  try {
    const full = trackFrom(await lookup(track.playUrl))
    if (!full) return
    track.info.title ||= full.info.title
    track.info.author ||= full.info.author
    track.artwork ||= full.artwork
    track.artistUrl ||= full.artistUrl
  } catch {
    // Metadata is optional; playback makes its own request.
  }
}

const versionWords = /\b(remix|cover|sped up|slowed|reverb|instrumental|karaoke|live|edit|nightcore|bootleg)\b|ريمكس|مسرع|مبط[أئ]|كاريوكي|حفلة/gu

function rank(track, title, artist) {
  const wanted = normalize(title)
  const name = normalize(track.info.title)
  const credit = normalize(artist)
  const owner = normalize(track.uploader || track.info.author)
  const words = new Set(wanted.split(' ').filter(Boolean))
  const found = new Set((name + ' ' + owner).split(' '))
  let score = [...words].filter(word => found.has(word)).length * 2
  if (name === wanted) score += 12
  if (credit && owner === credit) score += 12
  if (owner && wanted.includes(owner)) score += 4
  const modifiers = name.match(versionWords) || []
  if (modifiers.some(word => !words.has(word) && !wanted.includes(word))) score -= 30
  return score
}

export async function searchChoices(title, artist = '', source = 'SoundCloud') {
  const by = (artist === 'Spotify' ? '' : artist || '').replace(/ - Topic$/i, '').trim()
  const term = normalize(title).includes(normalize(by)) ? title : [by, title].join(' ')
  const result = await lookup('scsearch12:' + term.slice(0, 220), true)
  const unique = new Map()
  for (const item of result.entries || []) {
    const track = item && trackFrom(item)
    if (track && track.info.title && !unique.has(track.playUrl)) unique.set(track.playUrl, track)
  }
  const tracks = [...unique.values()].sort((a, b) => rank(b, title, by) - rank(a, title, by)).slice(0, 5)
  return { choices: true, source, tracks }
}

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error('Metadata service returned ' + r.status)
  return r.json()
}

async function singleMirror(url, type) {
  if (type === 'apple') {
    const id = url.searchParams.get('i') || /\/song\/[^/]+\/(\d+)/.exec(url.pathname)?.[1]
    if (!id || !/^\d+$/.test(id)) return { tracks: [] }
    const region = url.pathname.split('/')[1]
    const data = await json('https://itunes.apple.com/lookup?' + new URLSearchParams({ id, country: /^[a-z]{2}$/i.test(region) ? region : 'US' }))
    const track = data.results?.find(item => String(item.trackId) === id)
    if (!track) return { tracks: [] }
    return searchChoices(track.trackName, track.artistName, 'Apple Music')
  }
  const endpoint = type === 'spotify' ? 'https://open.spotify.com/oembed?' : 'https://www.youtube.com/oembed?'
  const meta = await json(endpoint + new URLSearchParams({ url: url.href, format: 'json' }))
  if (!meta.title) return { tracks: [] }
  return searchChoices(meta.title, meta.author_name, type === 'spotify' ? 'Spotify' : 'YouTube')
}

async function spotifyUrl(url) {
  for (let i = 0; i < 4 && ['spotify.link', 'spotify.app.link'].includes(url.hostname); i++) {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(7000) })
    const location = r.headers.get('location')
    if (!location) return null
    url = new URL(location, url)
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return null
  }
  return url.hostname === 'open.spotify.com' && /\/(?:track)\/[A-Za-z0-9]+\/?$/.test(url.pathname) ? url : null
}

export async function resolveTracks(input) {
  if (!/^https?:\/\//i.test(input)) {
    if (/^[a-z][\w+.-]*:/i.test(input)) return { tracks: [] }
    return searchChoices(input)
  }
  const url = new URL(input)
  if (url.port || url.username || url.password) return { tracks: [] }
  if (['open.spotify.com', 'spotify.link', 'spotify.app.link'].includes(url.hostname)) {
    const canonical = await spotifyUrl(url)
    return canonical ? singleMirror(canonical, 'spotify') : { tracks: [] }
  }
  if (url.hostname === 'music.apple.com') return singleMirror(url, 'apple')
  if (!directHosts.some(h => hostIs(url.hostname, h))) return { tracks: [] }
  const youtube = hostIs(url.hostname, 'youtube.com') || url.hostname === 'youtu.be'
  try {
    // Flat playlists retain individual track URLs. Single URLs return full metadata.
    const result = await lookup(url.href, true)
    const items = result.entries || [result]
    const tracks = items.filter(Boolean).map(trackFrom).filter(Boolean)
    if (!tracks.length && youtube && !result.entries) return singleMirror(url, 'youtube')
    return { tracks }
  } catch (error) {
    if (!youtube || url.pathname === '/playlist') throw error
    return singleMirror(url, 'youtube')
  }
}
