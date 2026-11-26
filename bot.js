import { randomUUID } from 'node:crypto'
import {
  ApplicationIntegrationType, ButtonStyle, Client, ComponentType, Events, GatewayIntentBits,
  InteractionContextType, MessageFlags, PermissionsBitField, Routes, escapeMarkdown
} from 'discord.js'
import { Audio } from './audio.js'
import { banner } from './banner.js'

const token = process.env.DISCORD_TOKEN
const password = process.env.LAVALINK_PASSWORD
if (!token || !password) {
  console.error('Set DISCORD_TOKEN and LAVALINK_PASSWORD in .env')
  process.exit(1)
}

const commands = {
  play: ['شغل', 'play', 'شغّل أغنية أو أضفها للقائمة', 'Play or queue a track'],
  next: ['تخط', 'skip', 'تخطّ الأغنية الحالية', 'Skip the current track'],
  queue: ['صف', 'queue', 'اعرض قائمة الانتظار', 'Show the queue'],
  stop: ['وقف', 'stop', 'أوقف التشغيل', 'Stop playback'],
  toggle: ['مؤقت', 'pause', 'أوقف مؤقتًا أو استأنف', 'Pause or resume playback'],
  previous: ['سابق', 'back', 'شغّل الأغنية السابقة', 'Play the previous track']
}
const translations = {
  ar: {
    voice: 'ادخل روم صوتي عشان تستخدم المشغّل.', same: 'ادخل نفس الروم الصوتي اللي فيه البوت.',
    permissions: 'أحتاج صلاحية الاتصال والتحدث في الروم الصوتي العادي.',
    online: 'سيرفر الصوت مو متصل الآن. جرّب بعد شوي.',
    empty: 'ما فيه أغنية شغالة.', ended: 'انتهت قائمة التشغيل.', stopped: 'تم إيقاف المشغّل.',
    noMatch: 'ما لقيت نتيجة. تأكد من الرابط أو جرّب اسم الأغنية.',
    failed: 'تعذّر تشغيل الأغنية أو تنفيذ الأمر. جرّب رابط ثاني.',
    queued: 'انضافت للقائمة', playing: 'بدأ التشغيل.', nothing: 'قائمة الانتظار فاضية.',
    waiting: 'قائمة الانتظار', previous: 'السابق', next: 'تخط', stop: 'وقف', queue: 'القائمة',
    pause: 'إيقاف مؤقت', resume: 'استئناف', paused: 'متوقف مؤقتًا', live: 'يشتغل الآن',
    stale: 'البطاقة هذي قديمة. استخدم بطاقة المشغّل الحالية.',
    noPrevious: 'ما فيه أغنية سابقة.', unknown: 'فنان غير معروف', full: 'القائمة وصلت الحد الأقصى.',
    blocked: 'الرابط مو من مصدر مفعّل في البوت.'
  },
  en: {
    voice: 'Join a voice channel to use the player.', same: 'Join the same voice channel as the bot.',
    permissions: 'I need Connect and Speak permissions in a regular voice channel.',
    online: 'The audio server is offline. Try again shortly.',
    empty: 'Nothing is playing.', ended: 'The queue has ended.', stopped: 'Playback stopped.',
    noMatch: 'No results. Check the link or try the song title.',
    failed: 'The action failed. Try a different link or try again.',
    queued: 'Added to the queue', playing: 'Playback started.', nothing: 'The queue is empty.',
    waiting: 'Queue', previous: 'Previous', next: 'Skip', stop: 'Stop', queue: 'Queue',
    pause: 'Pause', resume: 'Resume', paused: 'Paused', live: 'Now playing',
    stale: 'This card is outdated. Use the current player card.',
    noPrevious: 'There is no previous track.', unknown: 'Unknown artist', full: 'The queue is full.',
    blocked: 'This link is not from an enabled source.'
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] })
const audio = new Audio(process.env.LAVALINK_URL || 'http://127.0.0.1:2333', password, client)
const players = new Map()
const tasks = new Map()
const maxQueue = 100
const sources = new Set([
  'youtube.com', 'youtu.be', 'open.spotify.com', 'soundcloud.com', 'on.soundcloud.com',
  'music.apple.com', 'deezer.com', 'deezer.page.link', 'tidal.com', 'bandcamp.com',
  'twitch.tv', 'vimeo.com', 'audiomack.com', 'pandora.com', 'qobuz.com', 'mixcloud.com',
  ...(process.env.EXTRA_SOURCE_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean)
])
const textBlock = content => ({ type: ComponentType.TextDisplay, content })
const quiet = { parse: [] }

function serial(id, run) {
  const task = (tasks.get(id) || Promise.resolve()).catch(() => {}).then(run)
  tasks.set(id, task)
  void task.finally(() => {
    if (tasks.get(id) === task) tasks.delete(id)
  }).catch(() => {})
  return task
}

function externalUrl(value) {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

function allowedQuery(query) {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(query)) return true
  const url = externalUrl(query)
  return url && !url.port && [...sources].some(host => url.hostname === host || url.hostname.endsWith('.' + host))
}

function inline(value) {
  return escapeMarkdown(String(value).replace(/\s+/g, ' ').slice(0, 180)).replace(/[\[\]<>]/g, '\\$&')
}

function link(text, target) {
  const url = externalUrl(target)
  return url ? `[${inline(text)}](<${url.href.replace(/[<>]/g, encodeURIComponent)}>)` : inline(text)
}

function joinSource(track, query) {
  const url = externalUrl(query)
  if (url && !track.info.uri) track.info.uri = url.href
  return track
}

async function card(player, status) {
  const t = translations[player.language]
  const track = player.current
  let files = []
  const components = []
  if (track) {
    const title = track.info.title || t.live
    const artist = track.info.author || t.unknown
    const alt = `${title} — ${artist}`.slice(0, 500)
    files = [{ attachment: banner(title, artist, player.paused), name: 'player.gif', description: alt }]
    components.push({
      type: ComponentType.MediaGallery,
      items: [{ media: { url: 'attachment://player.gif' }, description: alt }]
    })
    components.push(textBlock(`**${link(title, track.info.uri)}**\n${link(artist, track.pluginInfo?.artistUrl || track.pluginInfo?.authorUrl)} · ${player.paused ? t.paused : t.live}`))
    const controls = [
      ['previous', t.previous, '⏮', !player.history.length],
      ['toggle', player.paused ? t.resume : t.pause, player.paused ? '▶' : '⏸'],
      ['next', t.next, '⏭'],
      ['stop', t.stop, '⏹'],
      ['queue', t.queue, '☰']
    ]
    components.push({
      type: ComponentType.ActionRow,
      components: controls.map(([action, label, icon, disabled]) => ({
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `music:${action}`,
        label: `${icon} ${label}`,
        disabled: Boolean(disabled)
      }))
    })
  } else {
    components.push(textBlock(status || t.empty))
  }

  const payload = {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: quiet,
    components: [{ type: ComponentType.Container, accent_color: 0x212121, components }],
    files
  }
  if (player.message) {
    try {
      player.message = await player.message.edit({ ...payload, attachments: [] })
      return
    } catch (error) {
      if (error.code !== 10008) throw error
      player.message = null
    }
  }
  if (track) player.message = await player.channel.send(payload)
}

async function refresh(player, status) {
  try {
    await card(player, status)
  } catch (error) {
    console.error('Player card:', error.message)
    return false
  }
  return true
}

async function close(player, status) {
  players.delete(player.guild.id)
  player.current = null
  try {
    if (audio.session) await audio.destroy(player.guild.id)
  } catch (error) {
    console.error(error.message)
  } finally {
    audio.leave(player.guild)
    await refresh(player, status)
  }
}

async function startTrack(player, track, voice) {
  const playbackId = randomUUID()
  await audio.player(player.guild.id, {
    track: { encoded: track.encoded, userData: { playbackId } },
    paused: false,
    ...(voice ? { voice, volume: 75 } : {})
  })
  player.current = track
  player.playbackId = playbackId
  player.paused = false
}

async function advance(player, ended) {
  const next = player.queue[0]
  if (!next) {
    await close(player, ended)
    return
  }
  const current = player.current
  await startTrack(player, next)
  player.queue.shift()
  player.history.push(current)
  if (player.history.length > maxQueue) player.history.shift()
  await refresh(player)
}

function resolveCommand(interaction) {
  if (interaction.isChatInputCommand()) {
    for (const [action, [arabic, english]] of Object.entries(commands)) {
      if (interaction.commandName === arabic) return { action, language: 'ar' }
      if (interaction.commandName === english) return { action, language: 'en' }
    }
  }
  if (interaction.isButton() && interaction.customId.startsWith('music:')) {
    return {
      action: interaction.customId.split(':')[1],
      language: players.get(interaction.guildId)?.language || (interaction.locale === 'ar' ? 'ar' : 'en')
    }
  }
  return {}
}

async function handle(interaction, action, language) {
  const player = players.get(interaction.guildId)
  const t = translations[language]
  const memberVoice = interaction.guild.voiceStates.cache.get(interaction.user.id)?.channel
  if (interaction.isButton() && player?.message?.id !== interaction.message.id) return t.stale
  if (!memberVoice) return t.voice
  if (player && player.voiceId !== memberVoice.id) return t.same
  if (!audio.session) return t.online

  if (action === 'play') {
    const self = interaction.guild.members.me
    const required = PermissionsBitField.Flags.Connect | PermissionsBitField.Flags.Speak
    if (memberVoice.type !== 2 || !self || !memberVoice.permissionsFor(self)?.has(required)) return t.permissions
    const query = interaction.options.getString(language === 'ar' ? 'بحث' : 'query', true).trim()
    if (!query) return t.noMatch
    if (!allowedQuery(query)) return t.blocked
    if (player?.queue.length === maxQueue) return t.full

    const tracks = (await audio.load(query)).map(track => joinSource(track, query))
    if (!tracks.length) return t.noMatch
    if (player) {
      const added = tracks.slice(0, maxQueue - player.queue.length)
      player.queue.push(...added)
      return `${t.queued} · ${added.length}`
    }

    const fresh = {
      guild: interaction.guild, channel: interaction.channel, voiceId: memberVoice.id,
      language, current: null, paused: false, history: [], queue: tracks.slice(1), message: null
    }
    players.set(interaction.guildId, fresh)
    try {
      const voice = await audio.join(interaction.guild, memberVoice.id)
      await startTrack(fresh, tracks[0], voice)
    } catch (error) {
      await close(fresh, t.failed)
      throw error
    }
    return await refresh(fresh) ? t.playing : `${t.playing} ${t.failed}`
  }

  if (!player?.current) return t.empty
  if (action === 'queue') {
    if (!player.queue.length) return t.nothing
    const items = player.queue.slice(0, 8).map((track, i) => `${i + 1}. ${inline(track.info.title).slice(0, 130)}`)
    return [`**${t.waiting} (${player.queue.length})**`, ...items].join('\n')
  }
  if (action === 'stop') {
    await close(player, translations[player.language].stopped)
    return t.stopped
  }
  if (action === 'toggle') {
    await audio.player(player.guild.id, { paused: !player.paused })
    player.paused = !player.paused
    await refresh(player)
    return player.paused ? t.paused : t.playing
  }
  if (action === 'previous') {
    const previous = player.history.at(-1)
    if (!previous) return t.noPrevious
    const current = player.current
    await startTrack(player, previous)
    player.history.pop()
    player.queue.unshift(current)
    await refresh(player)
    return t.playing
  }
  if (action === 'next') {
    const hasNext = player.queue.length > 0
    await advance(player, translations[player.language].ended)
    return hasNext ? t.playing : t.ended
  }
  return t.failed
}

client.on(Events.InteractionCreate, async interaction => {
  const { action, language } = resolveCommand(interaction)
  if (!action || !interaction.inCachedGuild()) return
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    const content = await serial(interaction.guildId, () => handle(interaction, action, language))
    await interaction.editReply({ content, allowedMentions: quiet })
  } catch (error) {
    console.error('Command:', error.message)
    if (interaction.deferred) await interaction.editReply(translations[language].failed).catch(() => {})
  }
})

client.on(Events.Raw, packet => audio.raw(packet))

audio.on('playerEvent', event => {
  if (!['TrackEndEvent', 'TrackExceptionEvent', 'TrackStuckEvent', 'WebSocketClosedEvent'].includes(event.type)) return
  if (event.type === 'TrackEndEvent' && !['finished', 'loadFailed'].includes(event.reason)) return
  void serial(event.guildId, async () => {
    const player = players.get(event.guildId)
    if (!player) return
    const t = translations[player.language]
    if (event.type === 'WebSocketClosedEvent') {
      if ([4014, 4006, 4015].includes(event.code)) await close(player, t.stopped)
      return
    }
    if (event.track?.userData?.playbackId !== player.playbackId) return
    try {
      await advance(player, event.reason === 'finished' ? t.ended : t.failed)
    } catch (error) {
      console.error('Advance:', error.message)
      await close(player, t.failed)
    }
  }).catch(error => console.error(error.message))
})

audio.on('voiceMoved', guildId => {
  if (players.has(guildId)) audio.voice.get(guildId)?.cancel?.()
  void serial(guildId, async () => {
    const player = players.get(guildId)
    if (player) await close(player, translations[player.language].stopped)
  }).catch(error => console.error(error.message))
})

audio.on('offline', () => {
  for (const id of players.keys()) {
    void serial(id, async () => {
      const player = players.get(id)
      if (player) await close(player, translations[player.language].online)
    }).catch(error => console.error(error.message))
  }
})

client.once(Events.ClientReady, async () => {
  audio.connect()
  const guildId = process.env.DISCORD_GUILD_ID
  const body = Object.entries(commands).flatMap(([action, [ar, en, arDesc, enDesc]]) =>
    ['ar', 'en'].map(lang => ({
      name: lang === 'ar' ? ar : en,
      description: lang === 'ar' ? arDesc : enDesc,
      ...(!guildId ? { integration_types: [ApplicationIntegrationType.GuildInstall], contexts: [InteractionContextType.Guild] } : {}),
      options: action === 'play' ? [{
        type: 3,
        name: lang === 'ar' ? 'بحث' : 'query',
        description: lang === 'ar' ? 'اسم الأغنية أو رابطها' : 'Track title or link',
        required: true,
        max_length: 500
      }] : []
    }))
  )
  const route = guildId ? Routes.applicationGuildCommands(client.user.id, guildId) : Routes.applicationCommands(client.user.id)
  try {
    // Upsert only these commands, so other commands on the application stay registered.
    for (const command of body) await client.rest.post(route, { body: command })
    console.log(`${client.user.tag}: registered ${body.length} commands`)
  } catch (error) {
    console.error('Command registration:', error.message)
  }
})

client.login(token).catch(error => {
  console.error('Discord login:', error.message)
  client.destroy()
  process.exitCode = 1
})
