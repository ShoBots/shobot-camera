const MAX_BOOKS = 20;
let scannedIsbns = new Map(); // key: ISBN, value: category (文字列)
let lastScannedTime = 0;
let userLineId = "";
let isModalOpen = false;
let pendingBooksData = null;
let currentDuplicates = [];

let currentEditingSingleId = null;
let currentEditingSeriesId = null;
let currentSeriesBooksData = [];
let previousSingleScreenId = 'screen-lf2';

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwfZ1-RHQ9FbqnhylY9WyZ7f2tFpFUzvWLxtFwsqStD1_QnL2Ftl0C7LeBjlfIvgU7k/exec"; 
const LIFF_ID = "2012030246-XEKrF6wY";

// 初期化 ＆ LIFFログイン
window.addEventListener("DOMContentLoaded", function() {
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');
  const type = urlParams.get('type');
  const targetId = urlParams.get('id');

  // 1. 編集モード（action === 'edit'）の時だけはカメラの初期化（Quagga.init）をスキップする
  if (action !== 'edit') {
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
  }

  // 2. LIFFログイン処理（画面表示は自然な流れに任せる）
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

          // URLパラメータがある場合は指定の編集画面を開く
          if (action === 'edit' && targetId) {
            if (type === 'series') {
              openSeriesEdit(targetId);
            } else {
              // LINEからの直接遷移時は戻り先を null に設定
              openSingleEdit(targetId, null);
            }
          }
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

  // カテゴリだけを記憶（ステータス保存は不要化）
  const currentBulkCat = document.getElementById("bulkCategory").value;
  scannedIsbns.set(isbn, currentBulkCat);
  renderLf1List();
}

// 一括指定（書籍区分のみ適用）
function applyBulkSettings() {
  const selectedCat = document.getElementById("bulkCategory").value;

  for (let isbn of scannedIsbns.keys()) {
    if (selectedCat !== "未設定") {
      scannedIsbns.set(isbn, selectedCat);
    }
  }
  
  renderLf1List();
}

// リスト内の個別の「書籍区分」を変更した時用
function updateIndividualCategory(isbn, category) {
  if (scannedIsbns.has(isbn)) {
    scannedIsbns.set(isbn, category);
  }
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

  const scanCountEl = document.getElementById("scanCount");
  if (scanCountEl) {
    scanCountEl.textContent = scannedIsbns.size;
  }

  if (!listEl) return;
  listEl.innerHTML = "";

  scannedIsbns.forEach((category, isbn) => {
    const li = document.createElement("li");
    li.className = "isbn-item";
    li.innerHTML = `
      <span>${isbn}</span>
      <div style="display: flex; align-items: center; gap: 6px;">
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

// GASバックエンド通信 (登録処理)
function submitScanList(forceRegister = false, customBooksData = null) {
  if (!customBooksData && scannedIsbns.size === 0) return;

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

  // 画面のドロップダウンから選択中のステータスを取得して一括指定
  const currentBulkStatus = document.getElementById("bulkStatus").value;

  const booksData = customBooksData || Array.from(scannedIsbns.entries()).map(([isbn, category]) => {
    return {
      isbn: isbn,
      category: category || '未設定',
      status: currentBulkStatus
    };
  });

  fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      action: "registerBooks",
      books: booksData,
      lineUserId: userLineId,
      forceRegister: forceRegister
    })
  })
  .then(res => res.json())
  .then(response => {
    if (response.status === "success") {
      pendingBooksData = null;
      onRegisterSuccess(response);
    } else if (response.status === "duplicate_warning") {
      if (loadingEl) loadingEl.style.display = "none";
      
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "登録";
      }

      pendingBooksData = booksData;
      currentDuplicates = response.duplicates || [];
      const titles = response.duplicates.map(d => `・${d.title}`).join("\n");
      showConfirmModal(
        `以下の書籍は既に登録されています。\n重複して登録しますか？\n\n${titles}`,
        "重複を除いて登録",
        "すべて登録",
        onConfirmDuplicate
      );
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
      <button class="btn-edit-sm" onclick="openSingleEdit(${item.userBookId}, 'screen-lf2')">修正</button>
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



function closeLiff() {
  if (typeof liff !== 'undefined' && liff.closeWindow) {
    liff.closeWindow();
  } else {
    showModal("右上の×を押してこのタブを閉じてください");
  }
}

let onModalCloseCallback = null;

function showModal(text, onClose = null) {
  isModalOpen = true;
  onModalCloseCallback = onClose;
  document.getElementById("modalMessage").innerText = text;

  // ボタン状態を標準（「閉じる」ボタン1個）にリセット
  resetModalButtons();

  document.getElementById("modalOverlay").style.display = "flex";
}

// モーダルのボタン状態を初期化する共通処理
function resetModalButtons() {
  const buttonsContainer = document.getElementById("modalButtons");
  const extraBtn = document.getElementById("btnModalCancel");
  if (extraBtn) extraBtn.remove();

  const mainBtn = buttonsContainer.querySelector("button");
  if (mainBtn) {
    mainBtn.className = "modal-btn";
    mainBtn.innerText = "閉じる";
    mainBtn.onclick = closeModal;
  }
}

// 確認用汎用モーダル（重複確認・削除確認などで使い回し）
function showConfirmModal(msg, cancelText, confirmText, onConfirm) {
  isModalOpen = true;
  document.getElementById("modalMessage").innerText = msg;

  const buttonsContainer = document.getElementById("modalButtons");

  if (!document.getElementById("btnModalCancel")) {
    const cancelBtn = document.createElement("button");
    cancelBtn.id = "btnModalCancel";
    cancelBtn.className = "btn-secondary";
    buttonsContainer.insertBefore(cancelBtn, buttonsContainer.firstChild);
  }

  const cancelBtn = document.getElementById("btnModalCancel");
  cancelBtn.innerText = cancelText;
  cancelBtn.onclick = closeModal;

  const allButtons = buttonsContainer.querySelectorAll("button");
  const confirmBtn = allButtons.length > 1 ? allButtons[1] : allButtons[0];

  if (confirmBtn) {
    confirmBtn.className = "btn-submit";
    confirmBtn.innerText = confirmText;
    confirmBtn.onclick = () => {
      closeModal();
      onConfirm();
    };
  }
  document.getElementById("modalOverlay").style.display = "flex";
}

function onConfirmDuplicate() {
  closeModal();
  submitScanList(true);
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  resetModalButtons();

  setTimeout(() => {
    isModalOpen = false;
    lastScannedTime = Date.now();
    if (typeof onModalCloseCallback === 'function') {
      const cb = onModalCloseCallback;
      onModalCloseCallback = null;
      cb();
    }
  }, 300);
}

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

// 蔵書データ修正 (LF3)
// 個別本 編集画面の読み込み
function openSingleEdit(userBookId, fromScreenId = null) {
  currentEditingSingleId = userBookId;
  previousSingleScreenId = fromScreenId;

  executeApiCall('getBookDetail', { userBookId: userBookId }, (data) => {
    // タイトル入力欄
    const titleEl = document.getElementById('singleEditTitleInput');
    if (titleEl) titleEl.value = data.title || '';

    // 巻数入力欄（NULL や undefined の場合は空文字）
    const volEl = document.getElementById('singleEditVolumeInput');
    if (volEl) {
      volEl.value = (data.volumeNumber !== null && data.volumeNumber !== undefined) ? data.volumeNumber : '';
    }

    document.getElementById('singleEditAuthor').textContent = data.authorName || '未設定';
    document.getElementById('singleEditLabel').textContent = data.publishingLabelName || '未設定';
    document.getElementById('singleEditCategory').value = data.bookType || 'その他';
    document.getElementById('singleEditStatus').value = data.status || '未読';

    switchScreen('screen-lf3');
  });
}

// シリーズ 編集画面の読み込み
function openSeriesEdit(seriesId) {
  currentEditingSeriesId = seriesId;

  executeApiCall('getSeriesDetail', { seriesId: seriesId }, (data) => {
    document.getElementById('seriesEditTitle').textContent = data.seriesName;
    document.getElementById('seriesEditAuthor').textContent = data.authorName || '未設定';
    document.getElementById('seriesEditLabel').textContent = data.publishingLabelName || '未設定';

    currentSeriesBooksData = data.books || [];
    renderSeriesAccordion();

    switchScreen('screen-lf4');
  });
}

// 画面描画 & 入力補助
// シリーズ用アコーディオン描画 (10冊ごと)
function renderSeriesAccordion() {
  const container = document.getElementById('seriesAccordionContainer');
  if (!container) return;
  container.innerHTML = "";

  if (currentSeriesBooksData.length === 0) {
    container.innerHTML = "<p style='text-align:center; padding:10px;'>表示できる本がありません。</p>";
    return;
  }

  const chunkSize = 10;
  for (let i = 0; i < currentSeriesBooksData.length; i += chunkSize) {
    const chunk = currentSeriesBooksData.slice(i, i + chunkSize);
    const startVol = i + 1;
    const endVol = i + chunk.length;

    const details = document.createElement('details');
    details.className = 'accordion-group';
    if (i === 0) details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'accordion-header';
    summary.textContent = `${startVol} - ${endVol}冊目`;
    details.appendChild(summary);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'accordion-content';

    chunk.forEach((book, index) => {
      const realIndex = i + index;
      const itemDiv = document.createElement('div');
      itemDiv.className = 'series-book-item';
      
      itemDiv.innerHTML = `
        <div class="series-book-title">${book.volumeNumber ? book.volumeNumber + '巻' : '単巻'} (${book.title || ''})</div>
        <div class="series-book-row">
          <select class="select-category" onchange="updateSeriesItem(${realIndex}, 'bookType', this.value)">
            <option value="漫画" ${book.bookType === '漫画' ? 'selected' : ''}>漫画</option>
            <option value="小説" ${book.bookType === '小説' ? 'selected' : ''}>小説</option>
            <option value="その他" ${book.bookType === 'その他' ? 'selected' : ''}>その他</option>
          </select>
          <input type="number" class="input-vol" value="${book.volumeNumber || ''}" placeholder="巻数" onchange="updateSeriesItem(${realIndex}, 'volumeNumber', this.value)" />
        </div>
        <div class="series-book-row">
          <select class="select-category" onchange="updateSeriesItem(${realIndex}, 'status', this.value)">
            <option value="読了" ${book.status === '読了' ? 'selected' : ''}>読了</option>
            <option value="未読" ${book.status === '未読' ? 'selected' : ''}>未読</option>
            <option value="読み途中" ${book.status === '読み途中' ? 'selected' : ''}>読み途中</option>
          </select>
          <button type="button" class="btn-delete" style="width:70px;" onclick="removeSeriesItem(${realIndex})">削除</button>
        </div>
      `;
      contentDiv.appendChild(itemDiv);
    });

    details.appendChild(contentDiv);
    container.appendChild(details);
  }
}

function updateSeriesItem(index, key, value) {
  if (currentSeriesBooksData[index]) {
    currentSeriesBooksData[index][key] = value;
  }
}

function removeSeriesItem(index) {
  currentSeriesBooksData.splice(index, 1);
  renderSeriesAccordion();
}

function applySeriesBulkCategory() {
  const val = document.getElementById('seriesBulkCategory').value;
  if (val === '未選択') return;
  currentSeriesBooksData.forEach(b => b.bookType = val);
  renderSeriesAccordion();
}

function applySeriesBulkStatus() {
  const val = document.getElementById('seriesBulkStatus').value;
  if (val === '未選択') return;
  currentSeriesBooksData.forEach(b => b.status = val);
  renderSeriesAccordion();
}

// 個別本 変更保存
function saveSingleEdit() {
  if (!currentEditingSingleId) return;

  const titleVal = document.getElementById('singleEditTitleInput') ? document.getElementById('singleEditTitleInput').value.trim() : '';
  const volVal = document.getElementById('singleEditVolumeInput') ? document.getElementById('singleEditVolumeInput').value.trim() : '';
  
  // 入力があれば数値、空文字なら null
  const volumeNumber = (volVal !== "") ? parseInt(volVal, 10) : null;

  const category = document.getElementById('singleEditCategory').value;
  const status = document.getElementById('singleEditStatus').value;

  const payload = {
    action: "updateSingleBook",
    userBookId: currentEditingSingleId,
    title: titleVal,
    volumeNumber: volumeNumber,
    bookType: category,
    status: status
  };

  executeApiCall('updateSingleBook', payload, () => {
    updateLf2ListCategoryLocal(currentEditingSingleId, category);
    showModal("変更を保存しました", () => {
      closeSingleEdit();
    });
  });
}

// シリーズ 変更保存
function saveSeriesEdit() {
  if (!currentEditingSeriesId) return;

  const payload = {
    action: "updateSeriesBooks",
    seriesId: currentEditingSeriesId,
    books: currentSeriesBooksData
  };

  executeApiCall('updateSeriesBooks', payload, () => {
    // モーダルの「閉じる」を押した後に closeLiff() を実行
    showModal("シリーズ情報を保存しました", () => {
      closeLiff();
    });
  });
}

// 個別本 削除
function deleteSingleBook() {
  if (!currentEditingSingleId) return;

  showConfirmModal("この本を蔵書から削除してもよろしいですか？", "キャンセル", "削除する", () => {
    executeApiCall('deleteSingleBook', { userBookId: currentEditingSingleId }, () => {
      removeLf2ListItemLocal(currentEditingSingleId);
      showModal("削除しました", () => closeSingleEdit());
    });
  });
}

// シリーズ 全削除
function deleteSeriesAll() {
  if (!currentEditingSeriesId) return;

  showConfirmModal("このシリーズの本をすべて削除してもよろしいですか？", "キャンセル", "削除する", () => {
    executeApiCall('deleteSeriesAll', { seriesId: currentEditingSeriesId }, () => {
      showModal("シリーズを全件削除しました", () => closeLiff());
    });
  });
}

// キャンセル & 共通ヘルパー (Close / Helper)
function closeSingleEdit() {
  currentEditingSingleId = null;
  if (previousSingleScreenId) {
    // 登録完了画面（LF2）から遷移してきた場合のみその画面に戻る
    switchScreen(previousSingleScreenId);
  } else {
    // LINE等から直接開いた場合は画面を閉じる
    closeLiff();
  }
}

function closeSeriesEdit() {
  currentEditingSeriesId = null;
  closeLiff();
}

// 画面切替共通関数
function switchScreen(activeScreenId) {
  ['screen-lf1', 'screen-lf2', 'screen-lf3', 'screen-lf4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === activeScreenId) ? 'block' : 'none';
  });

  // スキャン画面(LF1)以外へ移動した場合はカメラを一時停止し、LF1に戻ったら再開する
  if (typeof Quagga !== 'undefined') {
    if (activeScreenId === 'screen-lf1') {
      try { Quagga.start(); } catch(e) {}
    } else {
      try { Quagga.stop(); } catch(e) {}
    }
  }
}

// 通信処理共通ヘルパー
function executeApiCall(actionName, payload, onSuccess) {
  const loadingEl = document.getElementById("loadingOverlay");
  if (loadingEl) loadingEl.style.display = "block";

  if (!payload.action) payload.action = actionName;

  fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload)
  })
  .then(res => res.json())
  .then(response => {
    if (loadingEl) loadingEl.style.display = "none";
    if (response.status === "success") {
      onSuccess(response.data || response);
    } else {
      showModal("処理に失敗しました:\n" + (response.message || "エラー"));
    }
  })
  .catch(err => {
    if (loadingEl) loadingEl.style.display = "none";
    showModal("通信エラーが発生しました:\n" + err.message);
  });
}
