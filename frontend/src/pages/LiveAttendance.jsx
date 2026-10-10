import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, CircleStop, Download, Radio, UserCheck, Users, ScanFace, RefreshCw } from 'lucide-react'
import Layout from '../components/Layout'
import { api, API_URL, getToken } from '../lib/api'

export default function LiveAttendance({ user }) {
  const { id } = useParams(); const navigate = useNavigate()
  const videoRef = useRef(null); const canvasRef = useRef(null); const streamRef = useRef(null); const loopRef = useRef(null); const inFlight = useRef(false)
  const [session, setSession] = useState(null)
  const [attendance, setAttendance] = useState({ rows: [], present: 0, absent: 0, total: 0 })
  const [cameraOn, setCameraOn] = useState(false)
  const [faces, setFaces] = useState([])
  const [frameSize, setFrameSize] = useState({ width: 16, height: 9 })
  const [notice, setNotice] = useState(''); const [error, setError] = useState('')

  async function load() {
    try {
      const [s, a] = await Promise.all([api(`/api/sessions/${id}`), api(`/api/sessions/${id}/attendance`)])
      setSession(s); setAttendance(a)
    } catch (err) { setError(err.message) }
  }
  useEffect(() => { load(); return () => stopCamera() }, [id])

  async function startCamera() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream; videoRef.current.srcObject = stream; await videoRef.current.play()
      setFrameSize({ width: videoRef.current.videoWidth || 16, height: videoRef.current.videoHeight || 9 })
      setCameraOn(true); loopRef.current = setInterval(captureAndRecognize, 1100)
    } catch (err) { setError(`Camera access failed: ${err.message}`) }
  }

  function stopCamera() {
    if (loopRef.current) clearInterval(loopRef.current); loopRef.current = null
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    streamRef.current = null; setCameraOn(false); setFaces([])
  }

  async function captureAndRecognize() {
    const video = videoRef.current, canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2 || inFlight.current) return
    inFlight.current = true
    try {
      const w = video.videoWidth, h = video.videoHeight
      setFrameSize({ width: w, height: h }); canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(video, 0, 0, w, h)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84))
      const form = new FormData(); form.append('frame', blob, 'frame.jpg'); form.append('source', 'live_camera')
      const data = await api(`/api/sessions/${id}/recognize`, { method: 'POST', body: form })
      setFaces(data.faces || []); setFrameSize({ width: data.frame_width || w, height: data.frame_height || h })
      if (data.newly_marked?.length) {
        setNotice(`${data.newly_marked.join(', ')} marked present`); setTimeout(() => setNotice(''), 2500)
        setAttendance(await api(`/api/sessions/${id}/attendance`))
      }
    } catch (err) { setError(err.message) }
    finally { inFlight.current = false }
  }

  async function closeSession() { stopCamera(); try { await api(`/api/sessions/${id}/close`, { method: 'POST' }); await load() } catch (err) { setError(err.message) } }
  async function downloadCsv() {
    try {
      const response = await fetch(`${API_URL}/api/sessions/${id}/export.csv`, { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!response.ok) throw new Error('Could not export CSV')
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a')
      a.href = url; a.download = `attendance_session_${id}.csv`; a.click(); URL.revokeObjectURL(url)
    } catch (err) { setError(err.message) }
  }

  if (!session) return <Layout user={user}><div className="loading-page"><RefreshCw className="spin"/>Loading room…</div></Layout>

  return <Layout user={user}>
    <header className="page-header compact">
      <div className="header-with-back"><button className="icon-btn" onClick={() => navigate('/doctor')}><ArrowLeft size={19}/></button><div><span className="eyebrow">Real-time room · {session.room_name}</span><h1>{session.course_name}</h1><p>{session.title}</p></div></div>
      <div className="header-actions"><button className="ghost-btn" onClick={downloadCsv}><Download size={17}/>Export CSV</button>{session.status === 'open' && <button className="danger-btn" onClick={closeSession}><CircleStop size={17}/>Close session</button>}</div>
    </header>
    {error && <div className="error-box roomy">{error}</div>}{notice && <div className="toast-success">{notice}</div>}
    <section className="live-grid">
      <div className="camera-card">
        <div className="camera-toolbar"><div><span className={`live-dot ${cameraOn ? 'on' : ''}`}></span>{cameraOn ? 'Live recognition' : 'Camera idle'}</div><span>{faces.length} faces in frame</span></div>
        <div className="video-stage" style={{aspectRatio: `${frameSize.width}/${frameSize.height}`}}>
          <video ref={videoRef} muted playsInline className="unmirrored-video" />
          {faces.map((face, i) => { const [x1,y1,x2,y2]=face.bbox; const style={left:`${x1/frameSize.width*100}%`,top:`${y1/frameSize.height*100}%`,width:`${(x2-x1)/frameSize.width*100}%`,height:`${(y2-y1)/frameSize.height*100}%`}; return <div key={`${face.track_id}-${i}`} className={`face-box ${face.name==='Unknown'?'unknown':''}`} style={style}><span>{face.name} · {(face.similarity*100).toFixed(0)}%</span></div> })}
          {!cameraOn && <div className="camera-placeholder"><div className="scan-orb"><ScanFace size={42}/></div><h3>Room camera is off</h3><p>The feed is kept in normal orientation — no mirror transform.</p></div>}
        </div>
        <canvas ref={canvasRef} className="hidden-canvas" />
        <div className="camera-actions">{session.status === 'closed' ? <span className="closed-note">This session is closed.</span> : !cameraOn ? <button className="primary-btn auto" onClick={startCamera}><Camera size={18}/>Start room camera</button> : <button className="ghost-btn" onClick={stopCamera}><CircleStop size={17}/>Stop camera</button>}<span className="muted">3 matching observations are required before check-in.</span></div>
      </div>
      <Roster attendance={attendance} />
    </section>
  </Layout>
}

function Roster({ attendance }) {
  return <aside className="attendance-panel"><div className="mini-stats"><div><UserCheck size={18}/><span>Present<strong>{attendance.present}</strong></span></div><div><Users size={18}/><span>Total<strong>{attendance.total}</strong></span></div></div><div className="panel-head"><div><span className="eyebrow">Course roster</span><h2>Attendance</h2></div><Radio size={20}/></div><div className="roster-list">{attendance.rows.map(row => <div className="roster-row" key={row.user_id}><div className="avatar small">{row.name?.[0]}</div><div><strong>{row.name}</strong><span>{row.student_id || 'No student ID'} · {row.enrolled ? 'Face ready' : 'No face profile'}</span></div><span className={`attendance-pill ${row.status.toLowerCase()}`}>{row.status}</span></div>)}</div></aside>
}
