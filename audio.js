import { spawn } from 'node:child_process'
import { AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, createAudioPlayer,
  createAudioResource, entersState, joinVoiceChannel } from '@discordjs/voice'
import { commonArgs, downloader } from './media.js'

export async function connectVoice(guild, channelId, onDisconnect) {
  const connection = joinVoiceChannel({ guildId: guild.id, channelId,
    adapterCreator: guild.voiceAdapterCreator, selfDeaf: true })
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000)
  } catch (error) {
    connection.destroy()
    throw error
  }
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try { await entersState(connection, VoiceConnectionStatus.Ready, 5000) }
    catch { if (connection.state.status !== VoiceConnectionStatus.Destroyed) onDisconnect() }
  })
  return connection
}

export function makePlayer(onEnd) {
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } })
  player.on('error', error => onEnd(error.resource, true))
  player.on(AudioPlayerStatus.Idle, previous => {
    if (previous.resource) onEnd(previous.resource, previous.resource.metadata.failed || !previous.resource.playbackDuration)
  })
  return player
}

export function streamResource(track, onFailure) {
  const source = spawn(downloader, [...commonArgs, '--no-playlist', '-f', 'bestaudio/best', '-o', '-', '--', track.playUrl],
    { stdio: ['ignore', 'pipe', 'ignore'] })
  const encoder = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn',
    '-ar', '48000', '-ac', '2', '-c:a', 'libopus', '-b:a', '96k', '-f', 'ogg', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'ignore'] })
  const meta = { failed: false }
  const resource = createAudioResource(encoder.stdout, { inputType: StreamType.OggOpus, metadata: meta })
  let closed = false
  const cleanup = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    source.stdout.unpipe(encoder.stdin)
    source.kill('SIGKILL')
    encoder.kill('SIGKILL')
  }
  const fail = () => {
    if (closed || meta.failed) return
    meta.failed = true
    onFailure(resource, true)
    cleanup()
  }
  const timer = setTimeout(fail, 45000)
  encoder.stdout.once('readable', () => clearTimeout(timer))
  encoder.stdin.on('error', () => {})
  for (const proc of [source, encoder]) {
    proc.once('error', fail)
    proc.once('close', code => { if (code !== 0) fail() })
  }
  source.stdout.pipe(encoder.stdin)
  return { resource, cleanup }
}
