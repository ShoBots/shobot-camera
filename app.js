const MAX_BOOKS = 20;
let scannedIsbns = new Map(); // key: ISBN, value: category
let lastScannedTime = 0;
let userLineId = "";
let isModalOpen = false;

// あなたのGAS Web App URLを設定
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"; 
const LIFF_ID = "YOUR_LIFF_ID"; // LIFF IDを直接指定

// --- 1. 初期化 ＆ LIFFログイン ---
window.addEventListener("DOMContentLoaded", function() {
  // Quagga起動
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

  // LIFF初期化 & LINEユーザーID取得
  if (typeof liff !== 'undefined') {
    liff.init({ liffId: LIFF_ID })
      .then(() => {
        if (!liff.isLoggedIn()) {
          liff.login();
        } else {
          return liff.getProfile();
        }
      })
      .then(profile => {
        if (profile && profile.userId) {
          userLineId = profile.userId;
          console.log("LINEユーザーID取得成功:", userLineId);
        }
      })
      .catch(err => {
        console.error("LIFF初期化エラー:", err);
        showModal("LINEログイン情報の取得に失敗しました。\n画面を開き直してください。");
      });
  }
});

// --- 2. バーコード自動検知 (Quagga) ---
Quagga.onDetected(function(result) {
  if (isModalOpen) return;

  const now = Date.now();
  if (now - lastScannedTime < 1500) return;

  const code = result.codeResult.code;
  if (code && code.length === 13 && (code.startsWith("978") || code.startsWith("979"))) {
    lastScannedTime = now;
    addIsbnToList(code);
  }
});

// --- 3. 手動入力機能 (GAS LIFFjs.htmlより移植) ---
function addManualIsbn() {
  const inputEl = document.getElementById("manualIsbnInput");
  if (!inputEl) return;

  let isbn = inputEl.value
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
    })
    .replace(/[-‐\s]/g, "");

  if (!isbn) {
    showModal("ISBN(13桁の数字)を入力してください。");
    return;
  }

  if (!((isbn.startsWith("978") || isbn.startsWith("979")) && isbn.length === 13)) {
    showModal("正しい書籍のISBN(978または979から始まる13桁の数字)を入力してください。\n入力値: " + isbn);
    return;
  }

  addIsbnToList(isbn);
  inputEl.value = "";
}

// --- 4. リスト追加・操作ガード (GAS LIFFjs.htmlより移植) ---
function addIsbnToList(isbn) {
  if (scannedIsbns.has(isbn)) {
    showModal("既に同じISBNコードが入力されています");
    return;
  }

  if (scannedIsbns.size >= MAX_BOOKS) {
    showModal("読み込み件数が上限(20冊)に達しています。\n一度登録をしてください");
    return;
  }

  const currentBulkValue = document.getElementById("bulkCategory").value;
  scannedIsbns.set(isbn, currentBulkValue);
  renderLf1List();
}

function applyBulkCategory() {
  const selected = document.getElementById("bulkCategory").value;
  if (selected === "未設定") return;

  for (let isbn of scannedIsbns.keys()) {
    scannedIsbns.set(isbn, selected);
  }
  renderLf1List();
}

function updateIndividualCategory(isbn, category) {
  scannedIsbns.set(isbn, category);
}

function removeIsbn(isbn) {
  const submitBtn = document.getElementById("btnSubmitLf1");
  if (submitBtn && submitBtn.disabled && submitBtn.textContent === "登録中...") {
    return;
  }
  scannedIsbns.delete(isbn);
  renderLf1List();
}

function renderLf1List() {
  const listEl = document.getElementById("isbnList");
  const submitBtn = document.getElementById("btnSubmitLf1");

  if (!listEl) return;
  listEl.innerHTML = "";

  scannedIsbns.forEach((category, isbn) => {
    const li = document.createElement("li");
    li.className = "isbn-item";
    li.innerHTML = `
      <span>${isbn}</span>
      <div style="display: flex; align-items: center; gap: 8px;">
        <select class="select-category-sm" onchange="updateIndividualCategory('${isbn}', this.value)">
          <option value="未設定" ${category === '未設定' ? 'selected' : ''}>未設定</option>
          <option value="漫画" ${category === '漫画' ? 'selected' : ''}>漫画</option>
          <option value="小説" ${category === '小説' ? 'selected' : ''}>小説</option>
          <option value="その他" ${category === 'その他' ? 'selected' : ''}>その他</option>
        </select>
        <button class="btn-delete" onclick="removeIsbn('${isbn}')">削除</button>
      </div>
    `;
    listEl.appendChild(li);
  });

  if (submitBtn) {
    submitBtn.disabled = scannedIsbns.size === 0;
  }
}

// --- 5. GASバックエンド通信 (登録処理) ---
function submitScanList() {
  if (scannedIsbns.size === 0) return;

  if (!userLineId) {
    showModal("LINEユーザー情報の取得に失敗しました。\n一度画面を閉じて、LINEのトーク画面から開き直してください。");
    return;
  }

  const loadingEl = document.getElementById("loadingOverlay");
  if (loadingEl) loadingEl.style.display = "block";

  const submitBtn = document.getElementById("btnSubmitLf1");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "登録中...";
  }

  const booksData = Array.from(scannedIsbns.entries()).map(([isbn, category]) => {
    return { isbn: isbn, category: category };
  });

  // GASへ POST リクエスト送信
  fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      action: "registerBooks",
      books: booksData,
      lineUserId: userLineId
    })
  })
  .then(res => res.json())
  .then(response => {
    if (response.status === "success") {
      onRegisterSuccess(response);
    } else {
      onRegisterFailure(new Error(response.message || "登録エラー"));
    }
  })
  .catch(err => onRegisterFailure(err));
}

function onRegisterSuccess(response) {
  const loadingEl = document.getElementById("loadingOverlay");
  if (loadingEl) loadingEl.style.display = "none";

  document.getElementById("screen-lf1").style.display = "none";
  document.getElementById("screen-lf2").style.display = "block";

  const resultListEl = document.getElementById("registeredResultList");
  resultListEl.innerHTML = "";

  const results = response ? response.results || [] : [];
  results.forEach(item => {
    const li = document.createElement("li");
    li.className = "result-item";
    li.innerHTML = `
      <div class="result-info">
        <span class="result-title">${item.title}</span>
        <span class="result-cat">区分: ${item.category}</span>
      </div>
      <button class="btn-edit-sm" onclick="openLf3Edit(${item.userBookId})">修正</button>
    `;
    resultListEl.appendChild(li);
  });
}

function onRegisterFailure(error) {
  const loadingEl = document.getElementById("loadingOverlay");
  if (loadingEl) loadingEl.style.display = "none";

  const errorMsg = (error && error.message) ? error.message : "通信エラーが発生しました";
  showModal("登録に失敗しました:\n" + errorMsg);

  const submitBtn = document.getElementById("btnSubmitLf1");
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "登録";
  }
}

function goToLf1ForMore() {
  scannedIsbns.clear();
  renderLf1List();
  document.getElementById("btnSubmitLf1").disabled = true;
  document.getElementById("btnSubmitLf1").textContent = "登録";

  document.getElementById("screen-lf2").style.display = "none";
  document.getElementById("screen-lf1").style.display = "block";
}

function openLf3Edit(userBookId) {
  showModal("修正画面 (LF3) へ遷移: ID " + userBookId);
}

function closeLiff() {
  if (typeof liff !== 'undefined' && liff.closeWindow) {
    liff.closeWindow();
  } else {
    showModal("右上の×を押してこのタブを閉じてください");
  }
}

// モーダル表示制御
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
