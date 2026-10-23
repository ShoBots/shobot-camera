const MAX_BOOKS = 20;
let scannedIsbns = new Map(); // key: ISBN, value: category
let lastScannedTime = 0;
let userLineId = "";
let isModalOpen = false;
let pendingBooksData = null;

let currentEditingUserBookId = null;
let previousScreenId = 'screen-lf2';

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwfZ1-RHQ9FbqnhylY9WyZ7f2tFpFUzvWLxtFwsqStD1_QnL2Ftl0C7LeBjlfIvgU7k/exec"; 
const LIFF_ID = "2012030246-XEKrF6wY"; // LIFF IDを直接指定

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

// バーコード自動検知 (Quagga)
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

// 手動入力機能
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

// リスト追加・操作ガード
function addIsbnToList(isbn) {
  if (scannedIsbns.has(isbn)) {
    showModal("既に同じISBNコードが入力されています");
    return;
  }

  if (scannedIsbns.size >= MAX_BOOKS) {
    showModal("読み込み件数が上限(20冊)に達しています。\n一度登録をしてください");
    return;
  }

  const currentBulkCat = document.getElementById("bulkCategory").value;
  const currentBulkStatus = document.getElementById("bulkStatus").value;
  scannedIsbns.set(isbn, { category: currentBulkCat, status: currentBulkStatus });
  renderLf1List();
}

function applyBulkSettings() {
  const selectedCat = document.getElementById("bulkCategory").value;
  const selectedStatus = document.getElementById("bulkStatus").value;

  for (let [isbn, item] of scannedIsbns.entries()) {
    scannedIsbns.set(isbn, {
      category: selectedCat !== "未設定" ? selectedCat : (item.category || "未設定"),
      status: selectedStatus
    });
  }
  
  renderLf1List();
}

// リスト内の個別の「書籍区分」を変更した時用
function updateIndividualCategory(isbn, category) {
  const item = scannedIsbns.get(isbn);
  if (item) item.category = category;
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

  scannedIsbns.forEach((data, isbn) => {
    const li = document.createElement("li");
    li.className = "isbn-item";
    li.innerHTML = `
      <span>${isbn}</span>
      <div style="display: flex; align-items: center; gap: 6px;">
        <select class="select-category-sm" onchange="updateIndividualCategory('${isbn}', this.value)">
          <option value="未設定" ${data.category === '未設定' ? 'selected' : ''}>未設定</option>
          <option value="漫画" ${data.category === '漫画' ? 'selected' : ''}>漫画</option>
          <option value="小説" ${data.category === '小説' ? 'selected' : ''}>小説</option>
          <option value="その他" ${data.category === 'その他' ? 'selected' : ''}>その他</option>
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

// GASバックエンド通信 (登録処理)
function submitScanList(forceRegister = false) {
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

  const booksData = pendingBooksData || Array.from(scannedIsbns.entries()).map(([isbn, category]) => {
    return { isbn: isbn, category: data.category, status: data.status };
  });

  fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      action: "registerBooks",
      books: booksData,
      lineUserId: userLineId,
      forceRegister: forceRegister // 強制登録フラグを送信
    })
  })
  .then(res => res.json())
  .then(response => {
    if (response.status === "success") {
      pendingBooksData = null;
      onRegisterSuccess(response);
    } else if (response.status === "duplicate_warning") {
      // 重複警告を受け取った場合
      const loadingEl = document.getElementById("loadingOverlay");
      if (loadingEl) loadingEl.style.display = "none";
      
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "登録";
      }

      pendingBooksData = booksData; // 送信データを一時保持
      showDuplicateConfirmModal(response.duplicates);
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
      <button class="btn-edit-sm" onclick="openLf3Edit(${item.userBookId}, 'screen-lf2')">修正</button>
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

function openLf3Edit(userBookId, fromScreenId = 'screen-lf2') {
  currentEditingUserBookId = userBookId;
  previousScreenId = fromScreenId;

  const loadingEl = document.getElementById("loadingOverlay");
  if (loadingEl) loadingEl.style.display = "block";

  fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      action: "getBookDetail",
      userBookId: userBookId
    })
  })
  .then(res => res.json())
  .then(response => {
    if (loadingEl) loadingEl.style.display = "none";
    if (response.status === "success" && response.data) {
      const book = response.data;
      
      // 画面要素(LF3)へ値をセット
      document.getElementById('singleEditTitle').textContent = book.title;
      document.getElementById('singleEditAuthor').textContent = book.authorName;
      document.getElementById('singleEditLabel').textContent = book.publishingLabelName;
      document.getElementById('singleEditCategory').value = book.bookType;
      document.getElementById('singleEditStatus').value = book.status;

      // 画面切り替え (screen-lf3 を表示)
      document.getElementById(previousScreenId).style.display = 'none';
      document.getElementById('screen-lf3').style.display = 'block';
    } else {
      showModal("データの取得に失敗しました:\n" + (response.message || "データなし"));
    }
  })
  .catch(err => {
    if (loadingEl) loadingEl.style.display = "none";
    showModal("通信エラーが発生しました:\n" + err.message);
  });
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
  
  const buttonsContainer = document.getElementById("modalButtons");
  const extraBtn = document.getElementById("btnModalCancel");
  if (extraBtn) extraBtn.remove(); // 既存の動的ボタンがあれば削除

  const mainBtn = buttonsContainer.querySelector("button");
  if (mainBtn) {
    mainBtn.className = "modal-btn";
    mainBtn.innerText = "閉じる";
    mainBtn.onclick = closeModal;
  }

  document.getElementById("modalOverlay").style.display = "flex";
}

// 重複確認用モーダル表示（ボタン2つ化：左「キャンセル」 / 右「登録」）
function showDuplicateConfirmModal(duplicates) {
  isModalOpen = true;
  
  const titles = duplicates.map(d => `・${d.title}`).join("\n");
  const msg = `以下の書籍は既に登録されています。\n重複して登録しますか？\n\n${titles}`;
  
  document.getElementById("modalMessage").innerText = msg;

  const buttonsContainer = document.getElementById("modalButtons");
  
  // 左側に「キャンセル」ボタンを動的追加
  if (!document.getElementById("btnModalCancel")) {
    const cancelBtn = document.createElement("button");
    cancelBtn.id = "btnModalCancel";
    cancelBtn.className = "btn-secondary";
    cancelBtn.innerText = "キャンセル";
    cancelBtn.onclick = closeModal;
    buttonsContainer.insertBefore(cancelBtn, buttonsContainer.firstChild);
  }

  // 右側のボタンを「登録」に変更
  const confirmBtn = buttonsContainer.querySelector(".modal-btn, .btn-submit");
  if (confirmBtn) {
    confirmBtn.className = "btn-submit";
    confirmBtn.innerText = "登録";
    confirmBtn.onclick = onConfirmDuplicate;
  }

  document.getElementById("modalOverlay").style.display = "flex";
}

// 重複確認で「登録」を押した時
function onConfirmDuplicate() {
  closeModal();
  submitScanList(true); // forceRegister = true で再送信
}

// モーダルを閉じる処理（リセット）
function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  
  // 追加した「キャンセル」ボタンを削除して初期状態に戻す
  const extraBtn = document.getElementById("btnModalCancel");
  if (extraBtn) extraBtn.remove();

  const buttonsContainer = document.getElementById("modalButtons");
  const mainBtn = buttonsContainer.querySelector("button");
  if (mainBtn) {
    mainBtn.className = "modal-btn";
    mainBtn.innerText = "閉じる";
    mainBtn.onclick = closeModal;
  }

  setTimeout(() => {
    isModalOpen = false;
    lastScannedTime = Date.now();
  }, 500);
}

// LF3: 変更内容を保存する
function saveSingleEdit() {
  if (!currentEditingUserBookId) return;

  const category = document.getElementById('singleEditCategory').value;
  const status = document.getElementById('singleEditStatus').value;

  const loadingEl = document.getElementById("loadingOverlay");
  if (loadingEl) loadingEl.style.display = "block";

  fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      action: "updateSingleBook",
      userBookId: currentEditingUserBookId,
      bookType: category,
      status: status
    })
  })
  .then(res => res.json())
  .then(response => {
    if (loadingEl) loadingEl.style.display = "none";
    if (response.status === "success") {
      showModal("変更を保存しました");
      updateLf2ListCategoryLocal(currentEditingUserBookId, category);
      cancelSingleEdit();
    } else {
      showModal("保存に失敗しました:\n" + (response.message || "エラー"));
    }
  })
  .catch(err => {
    if (loadingEl) loadingEl.style.display = "none";
    showModal("通信エラーが発生しました:\n" + err.message);
  });
}

// LF3: この本を削除する
function deleteSingleBook() {
  if (!currentEditingUserBookId) return;

  if (!confirm("この本を蔵書から削除してもよろしいですか？")) {
    return;
  }

  const loadingEl = document.getElementById("loadingOverlay");
  if (loadingEl) loadingEl.style.display = "block";

  fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      action: "deleteSingleBook",
      userBookId: currentEditingUserBookId
    })
  })
  .then(res => res.json())
  .then(response => {
    if (loadingEl) loadingEl.style.display = "none";
    if (response.status === "success") {
      showModal("削除しました");
      removeLf2ListItemLocal(currentEditingUserBookId);
      cancelSingleEdit();
    } else {
      showModal("削除に失敗しました:\n" + (response.message || "エラー"));
    }
  })
  .catch(err => {
    if (loadingEl) loadingEl.style.display = "none";
    showModal("通信エラーが発生しました:\n" + err.message);
  });
}

// LF3: 変更せずに戻る
function cancelSingleEdit() {
  currentEditingUserBookId = null;
  document.getElementById('screen-lf3').style.display = 'none';
  document.getElementById(previousScreenId).style.display = 'block';
}

// 登録結果リスト（LF2）側の表示更新・削除用ヘルパー
function updateLf2ListCategoryLocal(userBookId, newCategory) {
  const editBtn = document.querySelector(`button[onclick*="openLf3Edit(${userBookId}"]`);
  if (editBtn) {
    const resultItem = editBtn.closest('.result-item');
    if (resultItem) {
      const catSpan = resultItem.querySelector('.result-cat');
      if (catSpan) catSpan.textContent = `区分: ${newCategory}`;
    }
  }
}

function removeLf2ListItemLocal(userBookId) {
  const editBtn = document.querySelector(`button[onclick*="openLf3Edit(${userBookId}"]`);
  if (editBtn) {
    const resultItem = editBtn.closest('.result-item');
    if (resultItem) resultItem.remove();
  }
}
