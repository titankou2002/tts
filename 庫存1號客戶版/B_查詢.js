function routeDispatcher(kw, db, maps, auth) {
  // 1. 漢樺轉碼 (漢XXXXXX -> 轉價目表 5:編號)
  if (kw.startsWith('漢')) {
    let m = kw.match(/^漢(\d{6,})/);
    if (m) {
      let r = db.price.find(row => String(row[maps.price['漢樺編號']]).toLowerCase() === m[1].toLowerCase());
      if (r) kw = kw.replace(/^漢\d+/, r[maps.price['編號']]);
    }
  }

  // 2. 圖片/規格 (直接回傳連結)
  const imgKeywords = ['圖片', '圖檔', '照片', '箱裝', '重量'];
  if (imgKeywords.some(k => kw.includes(k))) {
    let s = kw.replace(new RegExp(imgKeywords.join('|'), 'g'), '').trim();
    let r = db.price.find(row => String(row[maps.price['編號']]).toLowerCase().includes(s) || String(row[maps.price['中文系列']]).toLowerCase().includes(s));
    if (!r) return `❌ 查無「${s}」圖片相關資料\n`;
    let url = r[maps.price['雲端圖片']] ? "\n🖼️ 圖片：" + String(r[maps.price['雲端圖片']]).trim() : "";
    return `🆔 編號：${r[maps.price['編號']]}\n📚 系列：${r[maps.price['中文系列']]}\n🏭 產地：${r[maps.price['產地']]}\n📦 包裝：${r[maps.price['片/箱']]} 片/箱\n⚖️ 箱重：約 ${r[maps.price['KG/箱']]} KG${url}\n\n`;
  }

  // 3. 實際規格/厚度 (庫存表精確批次)
  if (/(尺寸|厚度|厚)/.test(kw)) {
    let s = kw.split("尺寸")[0].replace(/[^a-z0-9\-]/gi, '').trim();
    let rows = db.stock.filter(r => String(r[maps.stock['編號']]).toLowerCase().includes(s.toLowerCase()) && !String(r[maps.stock['品名']]).includes("小計"));
    if (!rows.length) return `❌ 查無 ${s} 的實際規格資料\n`;
    let res = `📐 ${s.toUpperCase()} 實際規格：\n`;
    rows.forEach(r => { if(r[maps.stock['備註(批號+尺寸)']]) res += `📌 ${r[maps.stock['備註(批號+尺寸)']]} ｜ ${r[maps.stock['實際尺寸']]} ｜ ${r[maps.stock['坪數']]}坪\n`; });
    return res + "\n";
  }

  // 4. 價格查詢 (同行價/King成本)
  const priceKeywords = ['價錢', '價格', '價目表', '錢'];
  if (priceKeywords.some(k => kw.includes(k))) {
    let s = kw.replace(new RegExp(priceKeywords.join('|'), 'g'), '').trim();
    let r = db.price.find(row => String(row[maps.price['編號']]).toLowerCase().includes(s) || String(row[maps.price['中文系列']]).toLowerCase().includes(s));
    if (!r) return `❌ 查無符合的價格資料\n`;
    let res = `📚 系列：${r[maps.price['中文系列']]}\n📐 尺寸：${r[maps.price['尺寸(cm)']]}\n💰 同行價：${r[maps.price['同行價']]} 元\n`;
    if (auth.level === 'king') res += `🧾 成本：${r[maps.price['成本']]} 元\n`;
    return res + "\n";
  }

  // 5. 尺寸 + 坪數大表查詢 (60x120 50坪)
  const sizeMatch = kw.match(/(\d{2,4})\s*[xX＊*×]\s*(\d{2,4})/);
  const qtyMatch = kw.match(/(\d+(?:\.\d+)?)\s*(坪|p)?$/i);
  if (sizeMatch && qtyMatch && kw.includes('坪')) {
    return handleSizeAndPingSearch(sizeMatch, qtyMatch, db, maps);
  }

  // 6. 編號 + 數量核心
  let mStock = kw.match(/^([a-z0-9\-]+)[\+\-\*\/\s]+(\d+(?:\.\d+)?)\s*(片|坪)$/);
  if (mStock) {
    let code = mStock[1], qty = parseFloat(mStock[2]), unit = mStock[3], isP = (unit === '坪');
    let r = db.main.find(row => String(row[maps.main['編號']]).toLowerCase().includes(code) && !String(row[maps.main['編號']]).includes('-期'));
    if (!r) return `❌ 查無「${code}」資料\n`;
    let avail = isP ? safeN(r[maps.main['可用坪數']]) : safeN(r[maps.main['扣保留']]);
    let total = isP ? safeN(r[maps.main['總庫存(坪數)']]) : safeN(r[maps.main['全庫存']]);
    let percent = (qty - avail) / qty;
    let res = "";
    if (avail >= qty) { res = "🟢 <庫存充足>\n📦 狀態：有貨喔!!快點下單 😆🛒\n"; }
    else if (percent <= 0.05) { res = "🟠 <庫存雖不足，只差5%!!>\n📦 狀態：庫存只差一點點，請盡速確認！😅🙇‍♂️\n"; }
    else if (percent <= 0.15) { res = "⚠️ <庫存不足，差10%左右>\n📦 狀態：仍有機會出貨，請聯繫業務！😅\n"; }
    else if (total >= qty) { res = "🟠 <庫存有貨，但被保留>\n📦 狀態：貨物被保留中，請洽業務協調。\n"; }
    else { res = "❌ <庫存不足>\n📦 狀態：你要的數量不夠了。😢🙇‍♂️\n"; }
    let bInfo = "";
    if (r[maps.main['入倉日期1']]) bInfo = `\n-----新批資訊-----\n✨ 到港：${Utilities.formatDate(new Date(r[maps.main['入倉日期1']]), "GMT+8", "yyyy/MM/dd")} (${Math.round(r[maps.main['數量1']])}片)`;
    return `${res}🆔 編號：${r[maps.main['編號']]}\n📚 系列：${r[maps.main['中文系列']] || r[maps.main['案名']]}\n📐 尺寸：${r[maps.main['尺寸']]}\n🔢 需求：${qty}${unit}\n📊 可用：${Math.round(avail)}${unit}${bInfo}\n\n`;
  }

  if (kw.includes('保留')) return handleReserveLogic(kw, db, maps, auth);

  // 7. 純編號查詢
  if (/^[a-z0-9\-]+$/i.test(kw)) {
    let r = db.main.find(row => String(row[maps.main['編號']]).toLowerCase().includes(kw) && !String(row[maps.main['編號']]).includes('-期'));
    if (!r) return `❌ 查無編號「${kw}」\n`;
    return `📦 編號：${r[maps.main['編號']]}\n📚 系列：${r[maps.main['中文系列']] || r[maps.main['案名']]}\n📐 尺寸：${r[maps.main['尺寸']]}\n🔒 保留：${r[maps.main['數量']]}片\n📊 可用：${r[maps.main['扣保留']]}片 / ${r[maps.main['可用坪數']]}坪\n\n`;
  }
  return "";
}