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

function matches(candidate, title, artist) {
  const wanted = normalize(title)
  const found = normalize(candidate.info.title)
  const by = normalize(artist?.replace(/ - Topic$/i, ''))
  const owner = normalize(candidate.info.author)
  if (!wanted || !found) return false
  if (!by) return found === wanted
  const combined = ' ' + found + ' '
  const requested = ' ' + wanted + ' '
  const titleMatches = found === wanted || found === by + ' ' + wanted || found === wanted + ' ' + by ||
    (requested === ' ' + owner + ' ' + found + ' ')
  return titleMatches && (owner === by || combined.includes(' ' + by + ' ') || requested.includes(' ' + owner + ' ') && owner)
}

export async function soundcloudMatch(title, artist, original, artwork) {
  const query = [artist, title].filter(Boolean).join(' ').slice(0, 220)
  const data = await lookup('scsearch8:' + query, true)
  const candidates = (data.entries || []).filter(Boolean).map(trackFrom).filter(Boolean)
  const matched = candidates.filter(track => matches(track, title, artist))
  if (!matched.length || (!artist && new Set(matched.map(t => normalize(t.info.author))).size > 1)) return []
  const chosen = matched[0]
  chosen.info.uri = original
  chosen.artwork = artwork || chosen.artwork
  chosen.mirror = true
  return [chosen]
}

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error('Metadata service returned ' + r.status)
  return r.json()
}

async function singleMirror(url, type) {
  if (type === 'apple') {
    const id = url.searchParams.get('i') || /\/song\/[^/]+\/(\d+)/.exec(url.pathname)?.[1]
    if (!id || !/^\d+$/.test(id)) return []
    const region = url.pathname.split('/')[1]
    const data = await json('https://itunes.apple.com/lookup?' + new URLSearchParams({ id, country: /^[a-z]{2}$/i.test(region) ? region : 'US' }))
    const track = data.results?.find(item => String(item.trackId) === id)
    if (!track) return []
    const found = await soundcloudMatch(track.trackName, track.artistName, url.href, track.artworkUrl100?.replace('100x100', '300x300'))
    if (found[0]) found[0].artistUrl = track.artistViewUrl
    return found
  }
  const endpoint = type === 'spotify' ? 'https://open.spotify.com/oembed?' : 'https://www.youtube.com/oembed?'
  const meta = await json(endpoint + new URLSearchParams({ url: url.href, format: 'json' }))
  if (!meta.title) return []
  return soundcloudMatch(meta.title, meta.author_name, url.href, meta.thumbnail_url)
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
    if (/^[a-z][\w+.-]*:/i.test(input)) return []
    const result = await lookup('scsearch1:' + input, true)
    return (result.entries || []).filter(Boolean).map(trackFrom).filter(Boolean)
  }
  const url = new URL(input)
  if (url.port || url.username || url.password) return []
  if (['open.spotify.com', 'spotify.link', 'spotify.app.link'].includes(url.hostname)) {
    const canonical = await spotifyUrl(url)
    return canonical ? singleMirror(canonical, 'spotify') : []
  }
  if (url.hostname === 'music.apple.com') return singleMirror(url, 'apple')
  if (!directHosts.some(h => hostIs(url.hostname, h))) return []
  const youtube = hostIs(url.hostname, 'youtube.com') || url.hostname === 'youtu.be'
  try {
    // Flat playlists retain individual track URLs. Single URLs return full metadata.
    const result = await lookup(url.href, true)
    const items = result.entries || [result]
    return items.filter(Boolean).map(trackFrom).filter(Boolean)
  } catch (error) {
    if (!youtube || url.pathname === '/playlist') throw error
    return singleMirror(url, 'youtube')
  }
}
