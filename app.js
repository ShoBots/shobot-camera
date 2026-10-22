const MAX_BOOKS = 20;
let lastScannedTime = 0;
const scannedSet = new Set();
let isModalOpen = false;

// 画面読み込み時にURLパラメータから既存のISBNを引き継ぐ
window.addEventListener("DOMContentLoaded", function() {
  const params = new URLSearchParams(window.location.search);
  const existingIsbnsParam = params.get("isbns");

  if (existingIsbnsParam) {
    const existingIsbns = existingIsbnsParam.split(",");
    existingIsbns.forEach(isbn => {
      if (isbn && !scannedSet.has(isbn)) {
        scannedSet.add(isbn);
        renderItem(isbn, true);
      }
    });
  }
});

// Quagga起動処理
Quagga.init({
  inputStream: {
    name: "Live",
    type: "LiveStream",
    target: document.querySelector('#interactive'),
    constraints: { facingMode: "environment" }
  },
  decoder: { readers: ["ean_reader"] }
}, function(err) {
  if (!err) Quagga.start();
});

// バーコード検知時処理
Quagga.onDetected(function(result) {
  if (isModalOpen) return;

  const now = Date.now();
  if (now - lastScannedTime < 1500) return;

  const code = result.codeResult.code;
  if (code && code.length === 13 && (code.startsWith("978") || code.startsWith("979"))) {
    lastScannedTime = now;

    // 重複チェック
    if (scannedSet.has(code)) {
      showModal("既に入力されているISBNコードです");
      return;
    }

    // 上限チェック
    if (scannedSet.size >= MAX_BOOKS) {
      showModal("読み込み件数が上限(" + MAX_BOOKS + "冊)に達しています。\n一度登録をしてください");
      return;
    }

    scannedSet.add(code);
    renderItem(code, false);
    sendToParent(code);
  }
});

// データ送信（postMessage + localStorageバックアップ）
function sendToParent(code) {
  const target = window.opener || window.parent;
  if (target && target !== window) {
    target.postMessage({ type: "SCAN_ISBN", isbn: code }, "*");
  }
  localStorage.setItem("LAST_SCANNED_ISBN", code + "_" + Date.now());
}

// リスト描画処理
function renderItem(isbn, isInitial) {
  const listEl = document.getElementById("scanList");
  const countEl = document.getElementById("count");
  
  const li = document.createElement("li");
  li.className = "scan-item";
  const tagText = isInitial ? "追加済み(既存)" : "追加済み";
  li.innerHTML = `<span>📖 ${isbn}</span><span style="color:#aabb88; font-weight:bold;">${tagText}</span>`;
  
  listEl.appendChild(li);
  countEl.textContent = scannedSet.size;
}

// モーダル制御
function showModal(text) {
  isModalOpen = true;
  document.getElementById("modalMessage").innerText = text;
  document.getElementById("modalOverlay").style.display = "flex";
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  setTimeout(() => {
    isModalOpen = false;
    lastScannedTime = Date.now();
  }, 500);
}

// 終了して戻る処理
// app.js

function closeAndReturn() {
  try { Quagga.stop(); } catch(e) {}

  // 1. PCブラウザ等の場合：通常通りウィンドウを閉じるを試みる
  if (window.opener && !window.opener.closed) {
    window.close();
    return;
  }

  // 2. LINE内ブラウザ等の場合：スキャンしたISBNを連れてGAS（親画面）のURLへ直接リダイレクトして戻る
  const GAS_URL = "https://script.google.com/macros/s/AKfycbwfZ1-RHQ9FbqnhylY9WyZ7f2tFpFUzvWLxtFwsqStD1_QnL2Ftl0C7LeBjlfIvgU7k/exec";
  const scannedList = Array.from(scannedSet).join(",");
  
  // GAS側にスキャン結果を渡して画面を再開
  window.location.href = GAS_URL + "?scannedIsbns=" + encodeURIComponent(scannedList);
}
