// Stock Events CSV stays separate from portfolio snapshots and daily P/L.
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TransactionsModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const headers = ['Symbol', 'Date', 'Quantity', 'Price', 'Price Currency', 'Fees Percentage', 'Fees Amount', 'Fees Currency'];
    const currencies = ['USD', 'CNY', 'HKD'];
    function cells(text) {
        const rows = []; let row = [], value = '', quoted = false;
        text = String(text).replace(/^\uFEFF/, '');
        for (let index = 0; index < text.length; index++) {
            const char = text[index];
            if (char === '"') { if (quoted && text[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted; }
            else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
                row.push(value); value = '';
                if (char !== ',') { if (char === '\r' && text[index + 1] === '\n') index++; if (row.some(cell => cell.trim())) rows.push(row); row = []; }
            } else value += char;
        }
        if (quoted) throw new Error('CSV 引号未闭合');
        row.push(value); if (row.some(cell => cell.trim())) rows.push(row);
        return rows;
    }
    function record(raw, id) {
        const values = headers.map(header => String(raw[header] ?? '').trim());
        const symbol = values[0].toUpperCase(), date = values[1];
        if (!/^[A-Z0-9][A-Z0-9.\-:]{0,23}$/.test(symbol)) throw new Error('代码格式无效');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('日期格式无效');
        const numeric = [2, 3, 5, 6].map(index => Number(values[index]));
        if (numeric.some(value => !Number.isFinite(value)) || numeric[1] < 0 || numeric[2] < 0 || numeric[2] > 100 || numeric[3] < 0) throw new Error('数量、价格或手续费无效');
        const currency = values[4] || values[7] || 'USD', feeCurrency = values[7] || currency;
        if (!currencies.includes(currency) || !currencies.includes(feeCurrency)) throw new Error('不支持的币种');
        const [quantity, price, feePct, feeAmount] = numeric;
        return { id, raw: Object.fromEntries(headers.map((header, index) => [header, values[index]])), symbol, date, quantity, price, currency, feeCurrency, feePct, feeAmount, type: quantity < 0 ? 'sell' : quantity > 0 ? 'buy' : 'fee' };
    }
    const key = row => JSON.stringify([row.symbol, row.date, row.quantity, row.price, row.currency, row.feePct, row.feeAmount, row.feeCurrency]);
    function importCSV(text, existing = [], makeId = () => 't-' + Math.random().toString(36).slice(2)) {
        const parsed = cells(text), columns = parsed.shift();
        if (!columns || columns.length !== headers.length || headers.some((header, index) => columns[index].trim().toLowerCase() !== header.toLowerCase())) throw new Error('请使用 Stock Events 的 8 列交易 CSV');
        const incoming = parsed.map((values, index) => { try { if (values.length !== headers.length) throw new Error('列数不一致'); return record(Object.fromEntries(headers.map((header, column) => [header, values[column]])), makeId()); } catch (error) { throw new Error('第 ' + (index + 2) + ' 行：' + error.message); } });
        const counts = new Map(); existing.forEach(row => counts.set(key(row), (counts.get(key(row)) || 0) + 1));
        const seen = new Map(); let skipped = 0;
        const added = incoming.filter(row => { const signature = key(row), count = (seen.get(signature) || 0) + 1; seen.set(signature, count); if (count <= (counts.get(signature) || 0)) { skipped++; return false; } return true; });
        return { rows: [...existing, ...added], added: added.length, skipped };
    }
    const escape = value => /[",\r\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
    function exportCSV(rows) { return headers.join(',') + '\r\n' + rows.map(row => headers.map(header => escape(row.raw[header] ?? '')).join(',')).join('\r\n') + (rows.length ? '\r\n' : ''); }
    function fee(row) { return row.feeCurrency === row.currency ? row.feeAmount + Math.abs(row.quantity) * row.price * row.feePct / 100 : null; }
    function summary(rows, symbol, currency) {
        const selected = rows.filter(row => (!symbol || row.symbol === symbol) && (!currency || row.currency === currency)).slice().sort((a, b) => a.date.localeCompare(b.date));
        const lots = new Map(); let realized = 0, knownSells = 0, unknownSells = 0;
        const fees = { USD: 0, CNY: 0, HKD: 0 };
        for (const row of selected) {
            fees[row.feeCurrency] += row.feeAmount;
            fees[row.currency] += Math.abs(row.quantity) * row.price * row.feePct / 100;
            const id = row.currency + ':' + row.symbol, lot = lots.get(id) || { quantity: 0, cost: 0, known: true };
            const charge = fee(row);
            if (row.quantity > 0) { lot.quantity += row.quantity; lot.cost += row.quantity * row.price + (charge ?? 0); if (charge === null) lot.known = false; }
            if (row.quantity < 0) {
                const sold = -row.quantity;
                if (lot.known && lot.quantity + 1e-8 >= sold && charge !== null) { const cost = lot.cost / lot.quantity * sold; realized += sold * row.price - charge - cost; lot.quantity -= sold; lot.cost = Math.max(0, lot.cost - cost); knownSells++; }
                else { unknownSells++; lot.quantity = Math.max(0, lot.quantity - sold); lot.known = false; }
            }
            lots.set(id, lot);
        }
        return { count: selected.length, buys: selected.filter(row => row.type === 'buy').length, sells: selected.filter(row => row.type === 'sell').length, fees, realized: knownSells && !unknownSells && new Set(selected.map(row => row.currency)).size === 1 ? realized : null, unknownSells, lots };
    }
    return { headers, cells, record, key, importCSV, exportCSV, fee, summary };
});
