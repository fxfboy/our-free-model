import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CircleAlert, Check, Eye, EyeOff, LoaderCircle, Network, RotateCcw, Save, Settings2, RefreshCw } from 'lucide-react'
import { Badge, Button, Card, Input } from './components/ui'
import { settingsDraft, settingsChanged, syncSettings, validateSettingsDraft } from './settings-data.mjs'
import { visibilityCopy } from './visibility-data.mjs'
import type { Host, Summary } from './types'
import './settings.css'

type Draft = ReturnType<typeof settingsDraft>
type NumberField = 'defaultMaxTokens' | 'probeIntervalMinutes' | 'standaloneLanPort'
const connectionError = (reason: unknown) => reason instanceof Error
  ? reason.name === 'TimeoutError' ? '保存请求超时，结果尚未确认。请重试或检查服务状态。'
    : reason instanceof TypeError && /fetch/i.test(reason.message) ? '无法连接本地服务，修改已保留，请确认服务正在运行后重试。'
    : reason.message : '保存失败，修改已保留，请重试。'

export function Settings({ summary, host, active }: { summary: Summary; host: Host; active: boolean }) {
  const visibility = visibilityCopy(document.documentElement.lang)
  const [state, setState] = useState(() => ({ saved: summary.settings, draft: settingsDraft(summary.settings) }))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<NumberField, string>>>({})
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  const generation = useRef(0)
  activeRef.current = active
  useEffect(() => () => { mounted.current = false; generation.current++ }, [])
  useEffect(() => {
    if (!active) { generation.current++; setMessage(''); setError('') }
  }, [active])
  useEffect(() => {
    setState(previous => syncSettings(previous, summary.settings, savingRef.current))
  }, [summary.settings])
  const dirty = settingsChanged(state.draft, state.saved)
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setState(previous => ({ ...previous, draft: { ...previous.draft, [key]: value } }))
    setErrors(previous => ({ ...previous, [key]: undefined }))
    setMessage(''); setError('')
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current || !activeRef.current) return
    const validation = validateSettingsDraft(state.draft)
    setErrors(validation.errors); setMessage(''); setError('')
    if (!validation.patch) return
    const started = ++generation.current
    const feedbackCurrent = () => mounted.current && activeRef.current && started === generation.current
    savingRef.current = true
    setSaving(true)
    try {
      const saved = await host.saveSettings(validation.patch)
      if (!mounted.current) return
      setState({ saved, draft: settingsDraft(saved) })
      if (feedbackCurrent()) setMessage('设置已保存并生效')
      // 保存结果已确认；后续读取失败不能误报为保存失败。
      try { await host.refresh() } catch {
        if (feedbackCurrent()) setMessage('设置已保存；状态刷新失败，稍后会自动重试。')
      }
    } catch (reason) {
      if (feedbackCurrent()) setError(connectionError(reason))
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const toggle = (name: 'enabled' | 'exposeRegionModels' | 'streamRecovery' | 'standaloneProbe' | 'hideFreeModels' | 'hideEacModels' | 'standaloneLanEnabled', label: string, help: string) =>
    <label className="settings-field" key={name}>
      <span><strong>{label}</strong><small>{help}</small></span>
      <input type="checkbox" role="switch" name={name} className="settings-toggle"
        checked={state.draft[name]} onChange={event => update(name, event.target.checked)} />
    </label>
  const numeric = (name: NumberField, label: string, help: string, min: number, max: number) =>
    <div className="settings-field settings-number-field">
      <label htmlFor={`setting-${name}`}><strong>{label}</strong><small>{help}</small></label>
      <div className="settings-number"><Input id={`setting-${name}`} name={name} type="number" min={min} max={max} step={1}
        value={state.draft[name]} onChange={event => update(name, event.target.value)}
        aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `setting-error-${name}` : undefined} />
        {errors[name] ? <p id={`setting-error-${name}`} className="settings-field-error" role="alert"><CircleAlert size={12} />{errors[name]}</p>
          : <span className="settings-hint">{min}–{max}</span>}
      </div>
    </div>
  const lan = summary.lan
  const [lanKey, setLanKey] = useState('')
  const [lanRevealed, setLanRevealed] = useState(false)
  const [lanBusy, setLanBusy] = useState(false)
  const [lanFeedback, setLanFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    void host.getLanKey().then(key => { if (alive) setLanKey(key) }).catch(() => {})
    return () => { alive = false }
  }, [active, host])
  const rotateLanKey = async () => {
    if (lanBusy) return
    if (!window.confirm('轮换后旧 LAN Key 立即失效，局域网客户端需要改用新密钥。继续？')) return
    setLanBusy(true); setLanFeedback(null)
    try {
      const key = await host.rotateLanKey()
      if (!mounted.current) return
      setLanKey(key); setLanRevealed(true)
      setLanFeedback({ tone: 'ok', text: 'LAN Key 已轮换，旧密钥已失效' })
    } catch (reason) {
      if (mounted.current) setLanFeedback({ tone: 'error', text: connectionError(reason) })
    } finally {
      if (mounted.current) setLanBusy(false)
    }
  }
  if (!active) return null
  const statusClass = saving ? 'settings-status-saving' : dirty ? 'settings-status-dirty' : message ? 'settings-status-saved' : ''
  return <div className="settings-browser" data-testid="settings-ready">
    <header className="dashboard-heading"><div><div className="heading-eyebrow">MANAGEMENT / SETTINGS</div>
      <h1>服务设置</h1><p>调整本机推理、模型刷新与局域网转发，保存后生效。</p></div>
      <Badge tone={summary.settings.enabled ? 'success' : 'warning'}>{summary.settings.enabled ? '推理服务已启用' : '推理服务已暂停'}</Badge>
    </header>
    <form onSubmit={event => { void submit(event) }} noValidate>
      <fieldset disabled={saving} className="settings-fieldset">
        <Card className="settings-card"><div className="settings-card-heading"><Settings2 size={16} /><div><h2>推理与模型</h2><p>控制客户端调用与模型展示。</p></div></div>
          {toggle('enabled', '启用推理服务', '关闭后暂停 API 推理，管理页面仍可访问。')}
          {toggle('exposeRegionModels', '显示地区受限模型', '保留受当前出口地区限制的模型供客户端选择。')}
          {toggle('hideFreeModels', visibility.hideFree, '仅从选择器和 API 模型清单隐藏，保留历史模型调用。')}
          {toggle('hideEacModels', visibility.hideEac, '保留授权和历史模型调用，可随时恢复显示。')}
          {toggle('streamRecovery', '自动恢复断流', '允许从已生成的检查点继续回答。')}
          {numeric('defaultMaxTokens', '单次最大输出 Token', '512–131072，实际输出还受模型能力限制。', 512, 131072)}
        </Card>
        <Card className="settings-card"><div className="settings-card-heading"><RefreshCw size={16} /><div><h2>模型刷新</h2><p>管理模型清单的周期更新与探测。</p></div></div>
          {numeric('probeIntervalMinutes', '刷新间隔（分钟）', '1–1440 分钟，保存后重新安排下一轮。', 1, 1440)}
          {toggle('standaloneProbe', '自动探测可用性', '周期刷新时发送探测请求，消耗上游额度；遇到限流会自动退避。')}
          <p className="settings-note" role="note"><CircleAlert size={15} /><span>{summary.automaticRefresh
            ? '自动刷新已启用，保存间隔后会重新安排下一轮。'
            : '当前以 --no-refresh 启动。设置会保存，但自动任务保持暂停；手动刷新仍可用。'}</span></p>
        </Card>
        <Card className="settings-card"><div className="settings-card-heading"><Network size={16} /><div><h2>局域网转发</h2><p>把推理接口暴露到局域网；管理页面仍只监听本机。</p></div>
          <Badge tone={lan?.running ? 'success' : lan?.enabled ? 'warning' : 'neutral'}>{lan?.running ? '运行中' : lan?.enabled ? '未运行' : '已关闭'}</Badge></div>
          {toggle('standaloneLanEnabled', '启用局域网转发', '中继监听所有网卡，只转发 /v1 推理接口，并要求 LAN Key；管理页面不会暴露。')}
          {numeric('standaloneLanPort', '监听端口', '0 表示自动分配；固定端口被占用时会报告错误并保留设置。', 0, 65535)}
          <div className="settings-field">
            <span><strong>监听地址</strong><small>中继绑定 0.0.0.0；本机 API 仍只监听 127.0.0.1。</small></span>
            <code className="settings-lan-address">{lan?.running ? `0.0.0.0:${lan.port}` : '127.0.0.1（仅本机）'}</code>
          </div>
          <div className="settings-field settings-lan-key-field">
            <span><strong>中继密钥（LAN Key）</strong><small>启用时自动生成；也可点轮换立即生成新密钥。局域网客户端使用 Bearer &lt;LAN Key&gt;，与本机 API Key 互不通用。</small></span>
            <div className="settings-lan-key">
              <Input readOnly type={lanRevealed ? 'text' : 'password'} value={lanKey} placeholder="尚未生成" aria-label="LAN Key" />
              <Button type="button" variant="outline" onClick={() => setLanRevealed(value => !value)}>{lanRevealed ? <EyeOff size={15} /> : <Eye size={15} />}{lanRevealed ? '隐藏' : '显示'}</Button>
              <Button type="button" variant="outline" disabled={lanBusy} onClick={() => { void rotateLanKey() }}>{lanBusy ? <LoaderCircle size={15} className="spinning" /> : <RefreshCw size={15} />}轮换</Button>
            </div>
          </div>
          {lan?.baseUrls.length ? <p className="settings-lan-urls">局域网地址：{lan.baseUrls.map(url => <code key={url}>{url}</code>)}</p> : null}
          {lan?.error ? <p className="settings-lan-error" role="alert"><CircleAlert size={15} /><span>{lan.error}</span></p> : null}
          {lanFeedback ? <p className={lanFeedback.tone === 'error' ? 'settings-lan-error' : 'settings-lan-ok'} role={lanFeedback.tone === 'error' ? 'alert' : 'status'}>{lanFeedback.tone === 'error' ? <CircleAlert size={15} /> : <Check size={15} />}<span>{lanFeedback.text}</span></p> : null}
          <p className="settings-note" role="note"><CircleAlert size={15} /><span>{lan?.running
            ? `中继正在 0.0.0.0:${lan.port} 运行，局域网客户端可用上方地址调用。`
            : lan?.enabled ? '已启用但中继未运行，保存后会重试；若仍失败请检查端口占用。'
              : '局域网转发未启用，当前只有本机可以访问推理接口。'}</span></p>
        </Card>
        <div className="settings-footer"><span role="status" aria-live="polite" className={statusClass}><span className="settings-status-dot" aria-hidden="true" />{saving ? '正在保存，请稍候…' : dirty ? '有尚未保存的修改' : message || '当前设置已同步'}</span>
          <div className="settings-actions"><Button variant="outline" disabled={!dirty || saving} onClick={() => {
            setState(previous => ({ ...previous, draft: settingsDraft(previous.saved) }))
            setErrors({}); setError(''); setMessage('')
          }}><RotateCcw size={15} />撤销修改</Button>
            <Button type="submit" disabled={!dirty || saving}>{saving ? <LoaderCircle size={15} className="spinning" /> : message && !dirty ? <Check size={15} /> : <Save size={15} />}{saving ? '正在保存' : '保存设置'}</Button></div>
        </div>
      </fieldset>
      {error && <p className="settings-save-error" role="alert"><CircleAlert size={16} /><span>{error}</span></p>}
    </form>
    <p className="footnote">配置保存在当前独立服务的数据目录中。页面读取和保存设置不会直接发送模型推理请求。</p>
  </div>
}
