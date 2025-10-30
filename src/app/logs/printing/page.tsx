'use client';

import { useEffect, useMemo, useState, Fragment } from 'react';

type Tx = {
  id: string; // local numeric UUID (string)
  uuid_id?: string; // if present in local mirror
  payment_method: string;
  pickup_method: string;
  final_amount: number;
  customer_name?: string | null;
  created_at: string;
};

type Audit1 = { transaction_id: string; printer1_receipt_number: number; printed_at: string; printed_at_epoch: number };
type Audit2 = { transaction_id: string; printer2_receipt_number: number; print_mode: 'auto' | 'manual'; cycle_number?: number | null; printed_at: string; printed_at_epoch: number };

export default function PrintingLogsPage() {
  const getTodayInUTC7 = () => {
    const nowUtc = new Date();
    const utcMs = nowUtc.getTime() + (nowUtc.getTimezoneOffset() * 60000);
    const utc7 = new Date(utcMs + 7 * 60 * 60 * 1000);
    const y = utc7.getUTCFullYear();
    const m = String(utc7.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utc7.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const [fromDate, setFromDate] = useState<string>(getTodayInUTC7());
  const [toDate, setToDate] = useState<string>(getTodayInUTC7());
  const computeUtcMsRangeUTC7 = (from: string, to: string) => {
    // Build UTC timestamps that correspond to UTC+7 00:00:00 and 23:59:59.999
    const parse = (s: string) => {
      const [y, m, d] = s.split('-').map(Number);
      // Create a Date at UTC for UTC+7 midnight by subtracting 7 hours
      const utcStart = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0);
      return utcStart - 7 * 60 * 60 * 1000;
    };
    const fromUtc7StartUtc = parse(from);
    const toUtc7EndUtc = parse(to) + (24 * 60 * 60 * 1000) - 1;
    return { fromMs: fromUtc7StartUtc, toMs: toUtc7EndUtc };
  };
  const [search, setSearch] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [audit1, setAudit1] = useState<Audit1[]>([]);
  const [audit2, setAudit2] = useState<Audit2[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load recent transactions from local DB (limit window for perf)
      const txs: any[] = await (window as any).electronAPI?.localDbGetTransactions?.(undefined, 500) || [];
      setTransactions(txs as Tx[]);

      const a1 = await (window as any).electronAPI?.getPrinter1AuditLog?.(fromDate || undefined, toDate || undefined, 1000);
      setAudit1(a1?.entries || []);

      const a2 = await (window as any).electronAPI?.getPrinter2AuditLog?.(fromDate || undefined, toDate || undefined, 1000);
      setAudit2(a2?.entries || []);
    } catch (e) {
      console.error('Failed to load printing logs:', e);
      setTransactions([]);
      setAudit1([]);
      setAudit2([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  const txIdToReceiptPrinted = useMemo(() => {
    const set = new Set<string>();
    for (const a of audit1) set.add(a.transaction_id);
    return set;
  }, [audit1]);

  const txIdToReceiptizePrinted = useMemo(() => {
    const set = new Set<string>();
    for (const a of audit2) set.add(a.transaction_id);
    return set;
  }, [audit2]);

  const filteredTxs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const { fromMs, toMs } = computeUtcMsRangeUTC7(fromDate, toDate);
    return transactions.filter(t => {
      const txMs = new Date(t.created_at).getTime();
      const inDate = (!fromDate && !toDate) || (txMs >= fromMs && txMs <= toMs);
      if (!q) return inDate;
      return (
        (t.id && String(t.id).toLowerCase().includes(q)) ||
        (t.uuid_id && t.uuid_id.toLowerCase().includes(q)) ||
        (t.customer_name && t.customer_name.toLowerCase().includes(q))
      );
    });
  }, [transactions, search, fromDate, toDate]);

  // Summary: total printed on receiptize vs total transactions
  const { totalAll, totalReceiptize, percentReceiptize } = useMemo(() => {
    const all = filteredTxs.reduce((sum, t) => sum + Number(t.final_amount || 0), 0);
    const rset = new Set<string>();
    for (const a of audit2) rset.add(a.transaction_id);
    const rz = filteredTxs.reduce((sum, t) => sum + (rset.has(t.id) ? Number(t.final_amount || 0) : 0), 0);
    const pct = all > 0 ? (rz / all) * 100 : 0;
    return { totalAll: all, totalReceiptize: rz, percentReceiptize: pct };
  }, [filteredTxs, audit2]);

  const toggleExpand = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  // Close handler (back to previous screen)
  const handleClose = () => {
    if (typeof window !== 'undefined') {
      window.history.back();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm">
      <div className="absolute inset-0 bg-white w-screen h-screen rounded-none shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white">
          <div>
            <h1 className="text-base font-bold text-gray-900">Printing Logs</h1>
          </div>
          <button onClick={handleClose} className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm">Close</button>
        </div>
        <div className="p-4 flex-1 overflow-y-auto">
      
      <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded border border-gray-200 p-3 bg-gray-50">
          <div className="text-xs text-gray-600">Total Transaksi (Rp)</div>
          <div className="text-lg font-semibold text-gray-900">{totalAll.toLocaleString('id-ID')}</div>
        </div>
        <div className="rounded border border-gray-200 p-3 bg-gray-50">
          <div className="text-xs text-gray-600">Total Dicetak Receiptize (Rp)</div>
          <div className="text-lg font-semibold text-purple-700">{totalReceiptize.toLocaleString('id-ID')}</div>
        </div>
        <div className="rounded border border-gray-200 p-3 bg-gray-50">
          <div className="text-xs text-gray-600">Persentase Receiptize</div>
          <div className="text-lg font-semibold text-gray-900">{percentReceiptize.toFixed(2)}%</div>
        </div>
      </div>
      

      <div className="flex flex-col md:flex-row md:items-end gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700">Dari</label>
          <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-black" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700">Sampai</label>
          <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-black" />
        </div>
        <div className="flex-1">
          <input placeholder="Search UUID/Customer" value={search} onChange={e=>setSearch(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1 text-black" />
        </div>
        <div>
          <button onClick={loadData} className="px-3 py-1 bg-gray-700 text-white rounded">Refresh</button>
        </div>
      </div>

      <div className="border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-2 text-left">Transaction UUID</th>
              <th className="px-2 py-2 text-left">Payment</th>
              <th className="px-2 py-2 text-left">Pickup</th>
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2 text-left">Customer</th>
              <th className="px-2 py-2 text-center">Receipt</th>
              <th className="px-2 py-2 text-center">Receiptize</th>
              <th className="px-2 py-2 text-left">Printed At (last)</th>
              <th className="px-2 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-600">Loading...</td></tr>
            ) : filteredTxs.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-600">No data</td></tr>
            ) : (
              filteredTxs.map(tx => {
                const receiptTick = txIdToReceiptPrinted.has(tx.id);
                const receiptizeTick = txIdToReceiptizePrinted.has(tx.id);
                const lastPrintedEpoch = Math.max(
                  ...[
                    ...audit1.filter(a=>a.transaction_id===tx.id).map(a=>a.printed_at_epoch),
                    ...audit2.filter(a=>a.transaction_id===tx.id).map(a=>a.printed_at_epoch)
                  ],
                  0
                );
                const lastPrintedAt = lastPrintedEpoch ? new Date(lastPrintedEpoch).toLocaleString('id-ID') : '';
                const isOpen = !!expanded[tx.id];
                return (
                  <Fragment key={tx.id}>
                    <tr className="border-t border-gray-100">
                      <td className="px-2 py-2 font-mono text-xs">{tx.id}</td>
                      <td className="px-2 py-2">{tx.payment_method}</td>
                      <td className="px-2 py-2">{tx.pickup_method}</td>
                      <td className="px-2 py-2 text-right">{Number(tx.final_amount || 0).toLocaleString('id-ID')}</td>
                      <td className="px-2 py-2">{tx.customer_name || ''}</td>
                      <td className="px-2 py-2 text-center">{receiptTick ? '✔' : ''}</td>
                      <td className="px-2 py-2 text-center">{receiptizeTick ? '✔' : ''}</td>
                      <td className="px-2 py-2">{lastPrintedAt}</td>
                      <td className="px-2 py-2">
                        <button className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200" onClick={()=>toggleExpand(tx.id)}>
                          {isOpen ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} className="bg-gray-50 px-3 py-3">
                          <Details transactionId={tx.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
        </div>
      </div>
    </div>
  );
}

function Details({ transactionId }: { transactionId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [productMap, setProductMap] = useState<Record<string, string>>({});
  const [p1, setP1] = useState<Audit1[]>([]);
  const [p2, setP2] = useState<Audit2[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const txItems = await (window as any).electronAPI?.localDbGetTransactionItems?.(undefined);
        const filtered = Array.isArray(txItems) ? txItems.filter((it:any)=> it.transaction_id === transactionId) : [];
        setItems(filtered);
        // Build product id -> name map to display names instead of numeric IDs
        const products = await (window as any).electronAPI?.localDbGetAllProducts?.();
        if (Array.isArray(products)) {
          const mp: Record<string, string> = {};
          for (const p of products) {
            if (p?.id != null && p?.nama) mp[String(p.id)] = String(p.nama);
          }
          setProductMap(mp);
        }
        const a1 = await (window as any).electronAPI?.getPrinter1AuditLog?.(undefined, undefined, 5000);
        setP1((a1?.entries || []).filter((e:Audit1)=> e.transaction_id === transactionId));
        const a2 = await (window as any).electronAPI?.getPrinter2AuditLog?.(undefined, undefined, 5000);
        setP2((a2?.entries || []).filter((e:Audit2)=> e.transaction_id === transactionId));
      } catch (e) {
        console.error('Failed to load details:', e);
      }
    })();
  }, [transactionId]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="border border-gray-200 rounded">
        <div className="px-3 py-2 bg-white border-b text-gray-800 font-medium">Items</div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Name</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Price</th>
                <th className="px-2 py-1 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-3 text-center text-gray-500">No items</td></tr>
              ) : items.map((it:any)=> (
                <tr key={it.id} className="border-t border-gray-100">
                  <td className="px-2 py-1">{it.product_name || productMap[String(it.product_id)] || String(it.product_id)}</td>
                  <td className="px-2 py-1 text-right">{it.quantity}</td>
                  <td className="px-2 py-1 text-right">{Number(it.unit_price||0).toLocaleString('id-ID')}</td>
                  <td className="px-2 py-1 text-right">{Number(it.total_price||0).toLocaleString('id-ID')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="border border-gray-200 rounded">
        <div className="px-3 py-2 bg-white border-b text-gray-800 font-medium">Print Events</div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Printer</th>
                <th className="px-2 py-1 text-left">Mode</th>
                <th className="px-2 py-1 text-right">Counter</th>
                <th className="px-2 py-1 text-left">Printed At</th>
              </tr>
            </thead>
            <tbody>
              {p1.map(e => (
                <tr key={`p1-${e.printed_at_epoch}`} className="border-t border-gray-100">
                  <td className="px-2 py-1">Receipt</td>
                  <td className="px-2 py-1">manual</td>
                  <td className="px-2 py-1 text-right">{e.printer1_receipt_number}</td>
                  <td className="px-2 py-1">{new Date(e.printed_at).toLocaleString('id-ID')}</td>
                </tr>
              ))}
              {p2.map(e => (
                <tr key={`p2-${e.printed_at_epoch}`} className="border-t border-gray-100">
                  <td className="px-2 py-1">Receiptize</td>
                  <td className="px-2 py-1">{e.print_mode}</td>
                  <td className="px-2 py-1 text-right">{e.printer2_receipt_number}</td>
                  <td className="px-2 py-1">{new Date(e.printed_at).toLocaleString('id-ID')}</td>
                </tr>
              ))}
              {p1.length===0 && p2.length===0 && (
                <tr><td colSpan={4} className="px-3 py-3 text-center text-gray-500">No print events</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


