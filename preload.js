const { contextBridge, ipcRenderer, clipboard } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

function on(channel, cb) {
  const listener = (_event, data) => cb(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('liquid', {
  init: () => invoke('app:init'),
  pair: (number) => invoke('core:pair', number),
  logout: () => invoke('core:logout'),
  setActive: (jid) => invoke('chat:set-active', jid),
  sendText: (jid, text, quoted) => invoke('chat:send-text', jid, text, quoted),
  sendImage: (jid, caption, quoted) => invoke('chat:send-image', jid, caption, quoted),
  sendMedia: (jid, caption, quoted) => invoke('chat:send-media', jid, caption, quoted),
  sendDroppedMedia: (jid, filePath, caption, quoted) => invoke('chat:send-dropped-media', jid, filePath, caption, quoted),
  sendVoiceNote: (jid, dataUrl, durationMs, quoted) => invoke('chat:send-voice-note', jid, dataUrl, durationMs, quoted),
  typing: (jid, on) => invoke('chat:typing', jid, on),
  loadChat: (jid) => invoke('chat:load', jid),
  searchMessages: (q, jid) => invoke('chat:search', q, jid),
  setChatMeta: (jid, patch) => invoke('chat:meta', jid, patch),
  archiveChat: (jid, value) => invoke('chat:archive', jid, value),
  pinChat: (jid, value) => invoke('chat:pin', jid, value),
  muteChat: (jid, value) => invoke('chat:mute', jid, value),
  read: (jid, ids) => invoke('chat:read', jid, ids),
  edit: (jid, id, text) => invoke('chat:edit', jid, id, text),
  del: (jid, id) => invoke('chat:delete', jid, id),
  react: (jid, msg, reaction) => invoke('chat:react', jid, msg, reaction),
  forward: (msg, targetJid) => invoke('chat:forward', msg, targetJid),
  poll: (jid, name, options) => invoke('chat:poll', jid, name, options),
  viewOnce: (jid, text) => invoke('chat:viewonce', jid, text),
  broadcast: (jids, text) => invoke('chat:broadcast', jids, text),
  mentionAll: (jid, text) => invoke('chat:mention-all', jid, text),
  disappear: (jid, sec) => invoke('chat:disappear', jid, sec),
  sticker: (jid) => invoke('chat:sticker', jid),
  star: (m) => invoke('chat:star', m),
  starred: () => invoke('chat:starred'),
  downloadMedia: (dto) => invoke('media:download', dto),
  contacts: () => invoke('contacts:list'),
  groupParticipants: (jid) => invoke('group:participants', jid),
  groupAction: (jid, action, participants) => invoke('group:action', jid, action, participants),
  groupSubject: (jid, subject) => invoke('group:subject', jid, subject),
  groupLeave: (jid) => invoke('group:leave', jid),
  postStatus: (text) => invoke('status:post', text),
  postStatusImage: (caption) => invoke('status:post-image', caption),
  setPrivacy: (key, value) => invoke('privacy:set', key, value),
  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),
  localInfo: () => invoke('local:info'),
  exportLocal: () => invoke('local:export'),
  addAutoReply: (rule) => invoke('autoreply:add', rule),
  removeAutoReply: (id) => invoke('autoreply:remove', id),
  getSchedules: () => invoke('schedule:list'),
  addSchedule: (s) => invoke('schedule:add', s),
  removeSchedule: (id) => invoke('schedule:remove', id),
  copyText: (t) => clipboard.writeText(String(t)),
  callAction: (action, callId, targetJid, isVideo) => invoke('call:action', action, callId, targetJid, isVideo),
  openExternal: (url) => invoke('external:open', url),

  on,
  onOpenChat: (cb) => on('open-chat', cb),
  onCallRing: (cb) => on('ev:call:ring', cb),
  onOutbox: (cb) => on('outbox', cb)
})
