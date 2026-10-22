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
        renderItem(isbn, true); // 引き継ぎ分として描画
      }
    });
  }
});

// Quagga（カメラ）起動処理
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
  // モーダル表示中は読み取りをガード
  if (isModalOpen) return;

  const now = Date.now();
  if (now - lastScannedTime < 1500) return; // 1.5秒インターバル

  const code = result.codeResult.code;
  if (code && code.length === 13 && (code.startsWith("978") || code.startsWith("979"))) {
    lastScannedTime = now;

    // 重複チェック
    if (scannedSet.has(code)) {
      showModal("既に同じISBNコードが入力されています");
      return;
    }

    // 上限チェック
    if (scannedSet.size >= MAX_BOOKS) {
      showModal("読み込み件数が上限(" + MAX_BOOKS + "冊)に達しています。\n一度登録をしてください");
      return;
    }

    scannedSet.add(code);

    // 1. この画面のリストに下へ追加（元の画面と同じ順）
    renderItem(code, false);

    // 2. データ送信（postMessage + localStorageバックアップ）
    sendToParent(code);
  }
});

// データ送信処理
function sendToParent(code) {
  // ① postMessage（PCや一部ブラウザ用）
  const target = window.opener || window.parent;
  if (target && target !== window) {
    target.postMessage({ type: "SCAN_ISBN", isbn: code }, "*");
  }
  
  // ② localStorage（スマホLINE内ブラウザ用のバックアップ）
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
  
  listEl.appendChild(li); // 一番下に追加
  countEl.textContent = scannedSet.size;
}

// 自作モーダルの表示・非表示制御
function showModal(text) {
  isModalOpen = true;
  document.getElementById("modalMessage").innerText = text;
  document.getElementById("modalOverlay").style.display = "flex";
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  setTimeout(() => {
    isModalOpen = false;
    lastScannedTime = Date.now(); // 閉じた直後の連続判定を防止
  }, 500);
}

// 「スキャンを終了して戻る」ボタンの処理
function closeAndReturn() {
  try { Quagga.stop(); } catch(e) {}
  
  // スマホのLINE等で window.close() が効かない場合の安全網（history.back）
  window.close();
  setTimeout(() => {
    if (!window.closed) {
      history.back();
    }
  }, 200);
}
