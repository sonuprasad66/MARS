import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { InventoryItem, Order, Summary, SyncJob } from "./types";

type Tab = "Overview" | "Inventory" | "Orders" | "Sync center" | "Blinkit CSV";

function App() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyJob, setBusyJob] = useState("");
  const [csv, setCsv] = useState("order_id,sku,qty,unit_price\nBLINKIT-DEMO-1,MRS-CRM-070,1,599");
  const [importResult, setImportResult] = useState<{ receivedRows: number; importedCount: number; importedOrders: string[]; errors: { row: number; message: string }[] } | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextInventory, nextOrders, nextJobs] = await Promise.all([
        api.summary(), api.inventory(search), api.orders(), api.jobs()
      ]);
      setSummary(nextSummary);
      setInventory(nextInventory.items);
      setOrders(nextOrders.items);
      setJobs(nextJobs.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load operations data");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function retry(id: string) {
    setBusyJob(id);
    setNotice("");
    try {
      await api.retry(id);
      setNotice("Retry queued.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not retry sync job");
    } finally {
      setBusyJob("");
    }
  }

  async function importCsv() {
    setImportBusy(true);
    setError("");
    setNotice("");
    try {
      setImportResult(await api.importBlinkit(csv));
      setNotice("CSV import processed. Review the row-level results below.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import CSV");
    } finally {
      setImportBusy(false);
    }
  }

  const failedJobs = jobs.filter((job) => job.status === "FAILED");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="MARS operations home">
          <span className="brand-mark">M</span>
          <span><strong>MARS</strong><small>OPERATIONS</small></span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(["Overview", "Inventory", "Orders", "Sync center", "Blinkit CSV"] as Tab[]).map((item, index) => (
            <button key={item} className={`nav-item ${tab === item ? "active" : ""}`} onClick={() => setTab(item)}>
              <span className="nav-icon">{["◫", "▤", "⇄", "◉", "⇧"][index]}</span>{item}
              {item === "Sync center" && failedJobs.length > 0 && <span className="nav-count">{failedJobs.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="status-dot" />
          <span>Local demo environment</span>
          <strong>MOCK</strong>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">MARS <span>/</span> {tab.toUpperCase()}</div>
          <div className="top-actions">
            <span className="mock-label"><i /> MOCK INTEGRATIONS</span>
            <button className="refresh-button" onClick={() => void refresh()} aria-label="Refresh data">↻ <span>Refresh</span></button>
            <div className="avatar" aria-label="Operations user">OP</div>
          </div>
        </header>

        <section className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">ORDER & INVENTORY SYNC</p>
              <h1>{tab === "Sync center" ? "Sync center" : tab}</h1>
              <p className="subtitle">A live view of orders, stock availability, and channel delivery.</p>
            </div>
            <div className="updated">● &nbsp;Connected to local API</div>
          </div>

          {error && <div className="alert error" role="alert">{error} <button onClick={() => void refresh()}>Retry</button></div>}
          {notice && <div className="alert success" role="status">{notice}</div>}
          {loading && <div className="loading" role="status">Loading operations data…</div>}

          {!loading && !error && tab === "Overview" && summary && (
            <>
              <div className="metric-grid">
                <Metric label="Orders today" value={summary.ordersToday} detail="All channels" icon="↗" />
                <Metric label="SKUs with reservations" value={summary.skusWithReservations} detail="Currently held stock" icon="▤" />
                <Metric label="Sync queue" value={summary.pendingJobs} detail="Waiting or processing" icon="◷" />
                <Metric label="Failed syncs" value={summary.failedJobs} detail="Require attention" icon="!" warning={summary.failedJobs > 0} />
              </div>
              <div className="section-grid">
                <section className="panel">
                  <div className="panel-heading"><div><h2>Recent orders</h2><p>Latest orders across all channels</p></div><button className="text-button" onClick={() => setTab("Orders")}>View orders →</button></div>
                  <OrderTable orders={orders.slice(0, 6)} />
                </section>
                <section className="panel attention-panel">
                  <div className="panel-heading"><div><h2>Needs attention</h2><p>Failed jobs that may need a retry</p></div><span className="pill red">{failedJobs.length} failed</span></div>
                  {failedJobs.length === 0 ? <Empty message="No failed syncs. Everything is up to date." /> : failedJobs.slice(0, 4).map((job) => <JobRow key={job.id} job={job} onRetry={retry} busy={busyJob === job.id} />)}
                  <div className="erp-status"><span className="erp-icon">BC</span><div><strong>Business Central adapter</strong><small>Local mock · durable retry queue</small></div><span className="pill green">Operational</span></div>
                </section>
              </div>
              <section className="panel inventory-preview">
                <div className="panel-heading"><div><h2>Inventory snapshot</h2><p>Available quantities across the central warehouse</p></div><button className="text-button" onClick={() => setTab("Inventory")}>All inventory →</button></div>
                <InventoryTable items={inventory.slice(0, 6)} />
              </section>
            </>
          )}
          {!loading && !error && tab === "Inventory" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><h2>Warehouse inventory</h2><p>Reserved units are excluded from available stock.</p></div><label className="search"><span>⌕</span><input aria-label="Search inventory" placeholder="Search SKU or product" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
              <InventoryTable items={inventory} />
              {inventory.length === 0 && <Empty message="No matching products found." />}
            </section>
          )}
          {!loading && !error && tab === "Orders" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><h2>Orders</h2><p>Orders accepted and reserved through the common inventory ledger.</p></div><span className="pill neutral">{orders.length} shown</span></div>
              <OrderTable orders={orders} expanded />
              {orders.length === 0 && <Empty message="No orders have been ingested yet." />}
            </section>
          )}
          {!loading && !error && tab === "Sync center" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><h2>Synchronization jobs</h2><p>Channel stock updates and ERP deliveries. Jobs use local mock adapters.</p></div><span className="pill red">{failedJobs.length} failed</span></div>
              <div className="job-list">
                {jobs.map((job) => <JobRow key={job.id} job={job} onRetry={retry} busy={busyJob === job.id} detailed />)}
                {jobs.length === 0 && <Empty message="No sync jobs yet." />}
              </div>
            </section>
          )}
          {!loading && !error && tab === "Blinkit CSV" && (
            <section className="panel full-panel">
              <div className="panel-heading"><div><h2>Import Blinkit orders</h2><p>Paste a CSV using order_id, sku, qty, and unit_price columns.</p></div><span className="pill neutral">MOCK IMPORT</span></div>
              <label className="csv-label" htmlFor="blinkit-csv">CSV contents</label>
              <label className="file-picker">Choose a CSV file<input aria-label="Choose Blinkit CSV file" type="file" accept=".csv,text/csv" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                void file.text().then(setCsv).catch(() => setError("Could not read the selected CSV file."));
              }} /></label>
              <textarea id="blinkit-csv" className="csv-input" value={csv} onChange={(event) => setCsv(event.target.value)} spellCheck={false} />
              <button className="primary-button" disabled={importBusy || !csv.trim()} onClick={() => void importCsv()}>{importBusy ? "Importing…" : "Validate and import"}</button>
              {importResult && <div className="import-results" role="status"><h3>Import summary</h3><p>Rows received: <strong>{importResult.receivedRows}</strong> · Orders created: <strong>{importResult.importedCount}</strong></p>{importResult.importedOrders.map((id) => <div className="import-row good" key={id}>✓ {id} imported; inventory reserved and sync jobs queued</div>)}{importResult.errors.map((item) => <div className="import-row bad" key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</div>)}{importResult.importedCount === 0 && importResult.errors.length === 0 && <p>No new orders (all IDs were already imported).</p>}</div>}
            </section>
          )}
          <footer>Inventory is reserved atomically in PostgreSQL · External systems are simulated in this demo.</footer>
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value, detail, icon, warning = false }: { label: string; value: number; detail: string; icon: string; warning?: boolean }) {
  return <article className={`metric-card ${warning ? "warning" : ""}`}><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>;
}

function Empty({ message }: { message: string }) {
  return <div className="empty-state"><span>✓</span><p>{message}</p></div>;
}

function Status({ value }: { value: string }) {
  const cls = value === "CONFIRMED" || value === "SUCCEEDED" ? "green" : value === "FAILED" || value === "REJECTED" ? "red" : "amber";
  return <span className={`pill ${cls}`}>{value.replace(/_/g, " ")}</span>;
}

function InventoryTable({ items }: { items: InventoryItem[] }) {
  return <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>ON HAND</th><th>RESERVED</th><th>AVAILABLE</th><th>CHANNEL SYNC</th></tr></thead>
    <tbody>{items.map((item) => <tr key={item.id}><td><div className="product-cell"><span className="product-avatar">{item.name.slice(0, 1).toUpperCase()}</span><div><strong>{item.name}</strong><small>{item.sku}</small></div></div></td><td>{item.onHand}</td><td>{item.reserved}</td><td><strong className={item.available < 5 ? "low-stock" : ""}>{item.available}</strong></td><td><div className="channel-dots">{item.channels.map((channel) => <span key={channel.channel} title={`${channel.channel}: ${channel.lastSyncedQty ?? "not synced"}`} className={channel.lastSyncedQty === item.available ? "synced" : "unsynced"}>{channel.channel.slice(0, 1)}</span>)}</div></td></tr>)}</tbody>
  </table></div>;
}

function OrderTable({ orders, expanded = false }: { orders: Order[]; expanded?: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>ORDER</th><th>CHANNEL</th>{expanded && <th>ITEMS</th>}<th>AMOUNT</th><th>STATUS</th><th>PLACED</th></tr></thead>
    <tbody>{orders.map((order) => <tr key={order.id}><td><strong className="order-id">{order.externalOrderId}</strong></td><td><span className="channel-name">{order.channel}</span></td>{expanded && <td>{order.lines.map((line) => `${line.product.sku} ×${line.quantity}`).join(", ")}</td>}<td>₹{Number(order.totalAmount).toLocaleString("en-IN")}</td><td><Status value={order.status} /></td><td>{new Date(order.createdAt).toLocaleString()}</td></tr>)}</tbody>
  </table></div>;
}

function JobRow({ job, onRetry, busy, detailed = false }: { job: SyncJob; onRetry: (id: string) => void; busy: boolean; detailed?: boolean }) {
  return <div className="job-row"><div className="job-status-dot" /><div className="job-info"><strong>{job.kind === "ERP_DELIVERY" ? "ERP order delivery" : `Stock update · ${job.channel}`}</strong><small>{job.lastError || (job.orderId ? `Order ${job.orderId.slice(0, 9)}` : `Qty ${job.desiredQty ?? "—"}`)}{detailed ? ` · ${job.attempts} attempts · ${new Date(job.createdAt).toLocaleString()}` : ""}</small></div><Status value={job.status} />{job.status === "FAILED" && <button className="retry-button" disabled={busy} onClick={() => onRetry(job.id)}>{busy ? "Queueing…" : "Retry"}</button>}</div>;
}

export default App;
