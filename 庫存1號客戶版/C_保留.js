function handleReserveLogic(kw, db, maps, auth) {
  let cust = kw.replace(/(保留|過期)/g, '').trim();
  const isOverdueQuery = kw.includes('過期');

  if (!['king'].includes(auth.level) && !auth.name.includes(cust) && !cust.includes(auth.name)) {
    return `⚠️ ${auth.level.toUpperCase()} 無權查他人保留，請洽業務。`;
  }

  let matched = db.main.slice(1).filter(r => String(r[maps.main['客戶']]).toLowerCase().includes(cust));
  if (!matched.length) return `❌ 查無「${cust}」保留資料\n`;

  let res = `📌 客戶：${cust}\n\n`, now = new Date();
  let groups = {};
  matched.forEach(r => { let p = r[maps.main['案名']] || r[maps.main['工地']] || '未命名'; if (!groups[p]) groups[p] = []; groups[p].push(r); });

  for (let p in groups) {
    let dates = groups[p].map(r => r[maps.main['保留日期']]).filter(d => d instanceof Date);
    let oldest = dates.length ? new Date(Math.min.apply(null, dates)) : null;
    let days = oldest ? Math.floor((now - oldest) / 86400000) : 0;
    
    if (isOverdueQuery && days < 60) continue;

    res += `🏷️ ${p}：\n`;
    groups[p].forEach(r => { res += `${r[maps.main['編號']]} ｜ ${r[maps.main['數量']]}片\n`; });
    if (oldest) {
      let lamp = days >= 60 ? '🔴' : days >= 45 ? '⚠️' : '🆗';
      res += `${Utilities.formatDate(oldest,"GMT+8","MM/dd")} ｜（${lamp} 保留${days}天）\n`;
      res += `訂金確認：${groups[p].some(r => r[maps.main['訂金確認']]) ? '💰' : '🈚'}\n\n`;
    }
  }
  return res;
}

function handleSizeAndPingSearch(sizeMatch, qtyMatch, db, maps) {
  const targetSize = normalizeSize(`${sizeMatch[1]}x${sizeMatch[2]}`);
  const targetQty = parseFloat(qtyMatch[1]);
  let found = [];
  
  db.main.slice(1).forEach(r => {
    if (normalizeSize(r[maps.main['尺寸']]) === targetSize && safeN(r[maps.main['可用坪數']]) >= targetQty) {
      let s = db.price.find(p => p[maps.price['編號']] === r[maps.main['編號']])?.[maps.price['中文系列']] || '一般';
      found.push(`🆗 ${s}/${r[maps.main['編號']]} (${Math.round(r[maps.main['可用坪數']])}坪)`);
    }
  });
  return found.length ? `📏 尺寸：${targetSize}\n🔁 需求：${targetQty}坪\n\n📋 符合現貨：\n${found.join('\n')}\n\n` : `❌ 無符合條件現貨\n`;
}

function handleSalesPush(auth, queries, fullReply, userId) {
  if (auth.salesID && (auth.level === 'free' || auth.level === 'class') && (queries.join(' ').includes('坪') || queries.join(' ').includes('片'))) {
    const logMsg = `📥 客戶查詢通知\n👤 客戶：${auth.name}\n💬 內容：${queries.join(' ')}\n\n📎 系統回覆：\n${fullReply.trim()}`;
    sendPush(auth.salesID, logMsg);
  }
}

function getHelpText() {
  return "🔹【 高雅瓷 AI 使用說明 】\n\n1️⃣ 查庫存：編號 + 數量\n👉 36033 10坪\n\n2️⃣ 查系列：系列名 + 圖片\n👉 冰岩圖片\n\n3️⃣ 查實際規格：編號 + 尺寸\n👉 36033 尺寸\n\n4️⃣ 查保留：公司名 + 保留\n👉 高雅瓷保留";
}