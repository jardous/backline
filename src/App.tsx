import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownUp, ArrowRight, AudioLines, Check, ChevronRight, Disc3, FileAudio,
  Headphones, KeyRound, ListMusic, LoaderCircle, LogOut, Menu, Music2,
  Plus, Repeat2, Search, Share2, X,
} from 'lucide-react'
import type { Library, Recording, SongGroup } from '../shared/types'
import { api, audioDuration, copyLink, message, uploadAudio } from './lib'
import UploadDialog from './components/UploadDialog'
import GroupDialog from './components/GroupDialog'
import Player from './components/Player'
import SongOverview from './components/SongOverview'
import LoginDialog, { type Auth } from './components/LoginDialog'

function currentRoute() {
  const query = new URLSearchParams(window.location.search)
  return { song: query.get('song'), recording: query.get('recording') }
}

export default function App() {
  const [library, setLibrary] = useState<Library>({ songs: [], groups: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'newest' | 'name'>('newest')
  const [route, setRoute] = useState(currentRoute)
  const [uploading, setUploading] = useState(false)
  const [songDialog, setSongDialog] = useState<SongGroup | 'new' | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [toast, setToast] = useState('')
  const [demoBusy, setDemoBusy] = useState(false)
  const [auth, setAuth] = useState<Auth>({ authenticated: false, configured: false })
  const [login, setLogin] = useState(false)
  const request = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notify = useCallback((value: string) => {
    setToast(value)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4200)
  }, [])
  const refresh = useCallback(async () => {
    const id = ++request.current
    try {
      const result = await api<Library>('/library')
      if (id === request.current) { setLibrary(result); setError('') }
      const session = await api<Auth>('/auth/session')
      if (id === request.current) setAuth(session)
    } catch (error) {
      if (id === request.current) setError(message(error))
    } finally { if (id === request.current) setLoading(false) }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 15_000)
    window.addEventListener('focus', refresh)
    const pop = () => setRoute(currentRoute())
    window.addEventListener('popstate', pop)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('popstate', pop) }
  }, [refresh])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const navigate = (songId: string | null = null, recordingId: string | null = null) => {
    const url = new URL(window.location.href)
    url.search = ''
    if (songId) url.searchParams.set('song', songId)
    if (recordingId) url.searchParams.set('recording', recordingId)
    window.history.pushState({}, '', url)
    setRoute({ song: songId, recording: recordingId })
    setSidebar(false)
    window.scrollTo({ top: 0 })
  }
  // Links shared before the song-first library used ?song=<recording ID>.
  const legacyRecording = !route.recording ? library.songs.find(item => item.id === route.song) : undefined
  const recording = library.songs.find(item => item.id === (route.recording || legacyRecording?.id))
  const selectedSong = library.groups.find(item => item.id === (recording?.groupId || route.song))
  const recordings = library.songs.filter(item => item.groupId === selectedSong?.id)
  const filesFor = (song: SongGroup) => library.songs.filter(item => item.groupId === song.id)
  const updated = (song: SongGroup) => filesFor(song).reduce((date, file) => file.updatedAt > date ? file.updatedAt : date, song.updatedAt)
  const filtered = library.groups.filter(song => {
    const query = search.trim().toLowerCase()
    return !query || `${song.name} ${song.notes}`.toLowerCase().includes(query)
      || filesFor(song).some(file => `${file.title} ${file.originalName} ${file.notes}`.toLowerCase().includes(query))
  }).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : updated(b).localeCompare(updated(a)))
  const totalLoops = library.songs.reduce((sum, item) => sum + item.loopCount, 0)
  const shareRoom = async () => {
    try { await copyLink(`${window.location.origin}${window.location.pathname}`); notify('Room link copied. Send it to your band!') }
    catch (error) { notify(message(error)) }
  }
  const demo = async () => {
    if (!selectedSong) return
    setDemoBusy(true)
    try {
      const response = await fetch('/demo.wav')
      if (!response.ok) throw new Error('Could not load the demo.')
      const file = new File([await response.blob()], 'Pocket groove (demo).wav', { type: 'audio/wav' })
      const data = new FormData()
      data.append('audio', file)
      data.append('duration', String(await audioDuration(file)))
      data.append('notes', 'An original synthesized demo groove. Drag across the waveform to select a loop, slow it down, and save a section for the band.')
      data.append('groupId', selectedSong.id)
      const result = await uploadAudio(data, () => {})
      await api(`/songs/${result.id}`, { method: 'PATCH', body: JSON.stringify({ bpm: 100 }) })
      await refresh()
      navigate(selectedSong.id, result.id)
      notify('Demo audio ready. Try looping a few bars.')
    } catch (error) { notify(message(error)) } finally { setDemoBusy(false) }
  }
  const openRecording = (file: Recording) => navigate(file.groupId, file.id)
  const missing = !loading && !error && ((route.recording && !recording) || (route.song && !selectedSong))

  return <div className="app-shell">
    {sidebar && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
      <button className="brand" onClick={() => navigate()} aria-label="Backline home">
        <span className="brand-icon"><AudioLines size={26} strokeWidth={2.3} /></span><span>backline<span className="brand-dot">.</span></span>
      </button>
      <div className="workspace-badge"><span className="workspace-avatar"><Headphones size={18} /></span>
        <div><strong>The band room</strong><small>Your shared practice space</small></div><span className="live-dot" /></div>
      <div className="nav-label">LIBRARY</div>
      <nav className="main-nav" aria-label="Library">
        <button className={`nav-item ${!route.song ? 'active' : ''}`} onClick={() => { setSearch(''); navigate() }}>
          <ListMusic size={19} /><span>All songs</span><span className="nav-count">{library.groups.length}</span>
        </button>
      </nav>
      <div className="nav-label groups-label">YOUR SONGS{auth.authenticated && <button className="icon-button" aria-label="Create song" onClick={() => setSongDialog('new')}><Plus size={16} /></button>}</div>
      <nav className="group-nav" aria-label="Songs">
        {library.groups.map(song => <button className={`nav-item ${selectedSong?.id === song.id ? 'active' : ''}`}
          key={song.id} onClick={() => navigate(song.id)}>
          <Music2 size={18} style={{ color: song.color }} /><span>{song.name}</span>
          <span className="nav-count">{filesFor(song).length}</span>
        </button>)}
        {!library.groups.length && <p className="no-groups">One home for every song.<br />Keep all its audios together.</p>}
      </nav>
      {auth.authenticated && <button className="new-group" onClick={() => setSongDialog('new')}><Plus size={16} />New song</button>}
      <div className="sidebar-bottom">
        <div className="together-card"><div className="mini-avatars"><span>♩</span><span>♫</span><span>♬</span><i><Check size={11} /></i></div>
          <strong>Better in a band.</strong><p>One room. Everyone in sync.<br />Share a link and make some noise.</p>
          <button onClick={shareRoom}>Invite your band <ArrowRight size={14} /></button></div>
        <div className="sidebar-footnote"><span className="live-dot" />{auth.authenticated ? 'Owner mode. Make it yours.' : 'Free to listen. Ready to practice.'}</div>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebar(true)}><Menu size={21} /></button>
        <div className="breadcrumbs"><Music2 size={16} /><button onClick={() => navigate()}>Library</button>
          <ChevronRight size={14} />{recording && selectedSong ? <><button className="song-crumb" onClick={() => navigate(selectedSong.id)}>{selectedSong.name}</button><ChevronRight size={14} /><span>{recording.title}</span></> :
            <span>{selectedSong?.name || 'All songs'}</span>}</div>
        <div className="topbar-actions"><button className="button share-button" onClick={shareRoom}><Share2 size={15} />Share room</button>
          {auth.authenticated ? <button className="button owner-button" onClick={async () => {
            try { await api('/auth/logout', { method: 'POST' }); setAuth(previous => ({ ...previous, authenticated: false })); notify('Signed out. Keep on practicing.') }
            catch (error) { notify(message(error)) }
          }}><LogOut size={14} />Sign out</button> : <button className="button owner-button" onClick={() => setLogin(true)}><KeyRound size={14} />Owner sign in</button>}</div>
      </header>
      <main>
        {error && <div className="connection-error" role="alert"><span>{error} Your library hasn’t been cleared.</span><button onClick={() => void refresh()}>Retry</button></div>}
        {missing ? <div className="empty-state"><Disc3 size={42} /><h2>This {route.recording ? 'audio' : 'song'} isn’t here anymore.</h2>
          <p>It may have been removed by the owner.</p><button className="button primary" onClick={() => navigate()}>Back to library</button></div> :
          selectedSong && recording ? <Player key={recording.id} song={recording} groups={library.groups} isOwner={auth.authenticated}
            onBack={() => navigate(selectedSong.id)} onRefresh={refresh} notify={notify}
            onDeleted={() => { navigate(selectedSong.id); void refresh() }} /> :
          selectedSong ? <SongOverview key={selectedSong.id} song={selectedSong} recordings={recordings} isOwner={auth.authenticated}
            onBack={() => navigate()} onOpen={openRecording} onUpload={() => setUploading(true)} onEdit={() => setSongDialog(selectedSong)}
            onRefresh={refresh} onDeleted={() => { navigate(); void refresh() }} notify={notify} onDemo={demo} demoBusy={demoBusy} /> :
          <div className="library-page">
            <section className="page-heading"><div><div className="eyebrow"><span />LESS FUMBLING. MORE PLAYING.</div>
              <h1>The practice room<span className="heading-dot">.</span></h1>
              <p>Your songs and all their audios, together in one place.</p></div>
              {auth.authenticated && <button className="button primary upload-button" onClick={() => setSongDialog('new')}><Plus size={18} />New song</button>}
            </section>
            <section className="room-overview" aria-label="Library overview">
              <div className="overview-copy"><span className="overview-icon"><Headphones size={23} /></span>
                <div><h2>One song. All its audios.</h2><p>Demos, backing tracks, and whatever helps you practice.<br className="desktop-break" /> All together. Ready for your next practice.</p></div></div>
              <div className="overview-stats"><div><strong>{library.groups.length.toString().padStart(2, '0')}</strong><span>songs to play</span></div>
                <span className="stats-divider" /><div><strong>{library.songs.length.toString().padStart(2, '0')}</strong><span>audios</span></div></div>
              <div className="decorative-wave" aria-hidden="true">{Array.from({ length: 29 }, (_, i) => <i key={i} style={{ height: `${12 + Math.sin(i * 1.45) ** 2 * 45 + Math.sin(i * .31) ** 2 * 28}px` }} />)}</div>
            </section>
            <section className="library-section">
              <div className="section-topline"><div className="section-title"><h2>Your songs</h2><span className="count-badge">{filtered.length}</span></div>
                <span className="library-summary">{totalLoops} shared {totalLoops === 1 ? 'loop' : 'loops'}</span></div>
              <div className="library-toolbar"><label className="search-box"><Search size={18} /><input type="search" placeholder="Find a song, an audio, or a note…"
                aria-label="Search songs" value={search} onChange={event => setSearch(event.target.value)} />
                {search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</label>
                <label className="sort-control"><ArrowDownUp size={15} /><select aria-label="Sort songs" value={sort} onChange={event => setSort(event.target.value as 'newest' | 'name')}>
                  <option value="newest">Recently updated</option><option value="name">Name A–Z</option></select></label></div>
              {loading ? <div className="loading-state"><LoaderCircle className="spin" size={24} /><p>Opening the practice room…</p></div> :
                filtered.length ? <div className="song-list collection-list">
                  <div className="song-table-heading"><span>SONG</span><span>AUDIOS</span><span>LOOPS</span><span>UPDATED</span><span /></div>
                  {filtered.map(song => {
                    const files = filesFor(song)
                    const count = files.reduce((sum, file) => sum + file.loopCount, 0)
                    return <button className="song-row" key={song.id} onClick={() => navigate(song.id)} data-song-id={song.id}>
                      <div className="song-info"><span className="song-art collection-art" style={{ color: song.color, backgroundColor: `${song.color}20` }}><Music2 size={23} /></span>
                        <span className="song-titles"><strong>{song.name}</strong><small>{song.notes.replace(/\n/g, ' ').slice(0, 90) || 'All your audios. One song.'}</small></span></div>
                      <span className="song-group version-count"><FileAudio size={15} />{files.length} {files.length === 1 ? 'audio' : 'audios'}</span>
                      <span className="song-loop-count"><Repeat2 size={15} />{count || '—'}</span>
                      <span className="song-duration">{new Date(updated(song)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><ChevronRight size={17} className="row-arrow" />
                    </button>
                  })}
                </div> : <div className="empty-state">
                  <div className="empty-illustration"><div className="empty-orbit" /><span><Music2 size={36} strokeWidth={1.5} /></span><i className="empty-note note-one">♪</i><i className="empty-note note-two">♫</i></div>
                  <h2>{search ? 'Nothing on that frequency.' : 'Every great set starts with a song.'}</h2>
                  <p>{search ? 'Try a song name, an audio name, or a word from your notes.' : auth.authenticated ? 'Create a song, then add its audios.' : 'The owner can sign in to add songs and their audios.'}</p>
                  {search ? <button className="button secondary" onClick={() => setSearch('')}>Clear search</button> :
                    auth.authenticated ? <button className="button primary" onClick={() => setSongDialog('new')}><Plus size={16} />Create your first song</button> :
                      <button className="button secondary" onClick={() => setLogin(true)}><KeyRound size={15} />Owner sign in</button>}
                </div>}
              {filtered.length > 0 && auth.authenticated && <button className="add-more" onClick={() => setSongDialog('new')}><Plus size={17} />Make room for another song.</button>}
            </section>
            <footer className="page-footer"><span><Repeat2 size={14} />Practice makes progress.</span><span>Made for the moments between rehearsals.</span></footer>
          </div>}
      </main>
    </div>
    {login && <LoginDialog configured={auth.configured} onClose={() => setLogin(false)} onLogin={value => { setAuth(value); notify('You’re signed in. The room is yours.') }} />}
    {uploading && selectedSong && auth.authenticated && <UploadDialog groups={library.groups} initialGroup={selectedSong.id}
      onClose={() => setUploading(false)} onUploaded={() => { void refresh(); notify('Audio added to the song.') }} />}
    {songDialog && auth.authenticated && <GroupDialog group={songDialog === 'new' ? undefined : songDialog} onClose={() => setSongDialog(null)}
      onSaved={song => {
        setLibrary(previous => ({ ...previous, groups: previous.groups.some(item => item.id === song.id)
          ? previous.groups.map(item => item.id === song.id ? song : item) : [...previous.groups, song] }))
        navigate(song.id); void refresh(); notify(songDialog === 'new' ? 'Song created. Add your first audio.' : 'Song renamed.')
      }} />}
    {toast && <div className="toast" role="status"><Check size={16} /><span>{toast}</span>
      <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>
}
