const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwfZ1-RHQ9FbqnhylY9WyZ7f2tFpFUzvWLxtFwsqStD1_QnL2Ftl0C7LeBjlfIvgU7k/exec";

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
  }
});

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
function closeAndReturn() {
  try { Quagga.stop(); } catch(e) {}

  const isbnList = Array.from(scannedSet);

  if (isbnList.length === 0) {
    showFinishScreen();
    return;
  }

  const btn = document.querySelector(".btn-close");
  if (btn) btn.disabled = true;

  // ★送信データをログに出力して確認
  console.log("送信データ:", JSON.stringify({ isbns: isbnList }));

  fetch(GAS_WEB_APP_URL, {
    method: "POST",
    mode: "cors", // CORS通信を明示
    headers: {
      "Content-Type": "text/plain;charset=utf-8", // GASの仕様上 text/plain が一番安定します
    },
    body: JSON.stringify({ isbns: isbnList })
  })
  .then(res => res.json())
  .then(data => {
    console.log("GASからのレスポンス:", data);
    showFinishScreen();
  })
  .catch(err => {
    console.error("送信エラー詳細:", err);
    showModal("送信に失敗しました: " + err.message);
    if (btn) btn.disabled = false;
  });
}

// スキャン完了後の案内表示
function showFinishScreen() {
  document.body.innerHTML = `
    <div style="padding: 50px 20px; text-align: center; font-family: sans-serif;">
      <h2 style="color: #aabb88; margin-bottom: 16px;">スキャン完了</h2>
      <p style="font-size: 14px; color: #333; line-height: 1.6; margin-bottom: 24px;">
        データを保存しました。<br>
        画面上の「✕」ボタン、または左上の「＜」で元の画面にお戻りください。
      </p>
    </div>
  `;
}
