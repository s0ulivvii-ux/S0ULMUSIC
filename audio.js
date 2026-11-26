import { EventEmitter } from 'node:events'
import WebSocket from 'ws'

export class Audio extends EventEmitter {
  constructor(url, password, client) {
    super()
    this.url = new URL(url)
    this.password = password
    this.client = client
    this.voice = new Map()
    this.session = null
  }

  connect() {
    const url = new URL('/v4/websocket', this.url)
    url.protocol = this.url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url, {
      handshakeTimeout: 10000,
      headers: {
        Authorization: this.password,
        'User-Id': this.client.user.id,
        'Client-Name': 'soul-music/1.0.0'
      }
    })
    socket.on('error', error => console.error('Lavalink:', error.message))
    socket.on('message', raw => {
      const event = JSON.parse(raw.toString())
      if (event.op === 'ready') {
        this.session = event.sessionId
        console.log('Lavalink ready')
      }
      if (event.op === 'event') this.emit('playerEvent', event)
    })
    socket.on('close', () => {
      this.session = null
      this.emit('offline')
      setTimeout(() => this.connect(), 5000).unref()
    })
  }

  async request(path, method = 'GET', body) {
    if (!this.session) throw new Error('Lavalink is offline')
    const response = await fetch(new URL(path, this.url), {
      method,
      headers: { Authorization: this.password, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000)
    })
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
      throw new Error(`Lavalink ${method} returned ${response.status}`)
    }
    if (response.status !== 204 && response.ok) return response.json()
  }

  player(guildId, body) {
    return this.request(`/v4/sessions/${this.session}/players/${guildId}`, 'PATCH', body)
  }

  destroy(guildId) {
    return this.request(`/v4/sessions/${this.session}/players/${guildId}`, 'DELETE')
  }

  async load(query) {
    const identifier = /^https?:\/\//i.test(query) ? query : `${process.env.SEARCH_PREFIX || 'ytsearch'}:${query}`
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(query) && !/^https?:\/\//i.test(query)) return []
    const { data, loadType } = await this.request(`/v4/loadtracks?${new URLSearchParams({ identifier })}`)
    switch (loadType) {
      case 'track': return [data]
      case 'search': return data.slice(0, 1)
      case 'playlist': return data.tracks.slice(0, 100)
      case 'error': throw new Error('Audio source rejected the request')
      default: return []
    }
  }

  signal(guild, channelId) {
    guild.shard.send({
      op: 4,
      d: { guild_id: guild.id, channel_id: channelId, self_mute: false, self_deaf: true }
    })
  }

  join(guild, channelId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.leave(guild)
        reject(new Error('Discord voice handshake timed out'))
      }, 8000)
      this.voice.set(guild.id, {
        channelId,
        cancel: () => {
          clearTimeout(timer)
          reject(new Error('Voice connection closed'))
        },
        ready: credentials => {
          clearTimeout(timer)
          resolve(credentials)
        }
      })
      this.signal(guild, channelId)
    })
  }

  leave(guild) {
    const state = this.voice.get(guild.id)
    this.voice.delete(guild.id)
    state?.cancel?.()
    this.signal(guild, null)
  }

  raw({ t, d }) {
    const state = this.voice.get(d?.guild_id)
    if (!state || !['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(t)) return
    if (t === 'VOICE_STATE_UPDATE') {
      if (d.user_id !== this.client.user.id) return
      if (d.channel_id !== state.channelId) {
        this.emit('voiceMoved', d.guild_id)
        return
      }
      state.sessionId = d.session_id
    } else {
      state.endpoint = d.endpoint
      state.token = d.token
    }
    if (!state.endpoint || !state.token || !state.sessionId) return
    const { endpoint, token, sessionId, channelId } = state
    const credentials = { endpoint, token, sessionId, channelId }
    if (state.ready) {
      state.ready(credentials)
      delete state.ready
      delete state.cancel
    } else {
      this.player(d.guild_id, { voice: credentials }).catch(error => console.error(error.message))
    }
  }
}
