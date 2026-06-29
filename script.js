// 50音表の定義（左から右の列順: あ、か、さ...）
const gojuonTable = [
    // あ行
    ['あ', 'い', 'う', 'え', 'お'],
    // か行
    ['か', 'き', 'く', 'け', 'こ'],
    // さ行
    ['さ', 'し', 'す', 'せ', 'そ'],
    // た行
    ['た', 'ち', 'つ', 'て', 'と'],
    // な行
    ['な', 'に', 'ぬ', 'ね', 'の'],
    // は行
    ['は', 'ひ', 'ふ', 'へ', 'ほ'],
    // ま行
    ['ま', 'み', 'む', 'め', 'も'],
    // や行
    ['や', '', 'ゆ', '', 'よ'],
    // ら行
    ['ら', 'り', 'る', 'れ', 'ろ'],
    // わ行
    ['わ', 'を', 'ん', '', '']
];

// 濁音・半濁音
const dakutenTable = [
    ['', '', '', '', ''],
    ['が', 'ぎ', 'ぐ', 'げ', 'ご'],
    ['ざ', 'じ', 'ず', 'ぜ', 'ぞ'],
    ['だ', 'ぢ', 'づ', 'で', 'ど'],
    ['', '', '', '', ''],
    ['ば', 'び', 'ぶ', 'べ', 'ぼ'],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', '']
];

const handakutenTable = [
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ'],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', '']
];

// 小文字（拗音・促音）
const smallKanaTable = [
    ['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ'],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', 'っ', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['ゃ', '', 'ゅ', '', 'ょ'],
    ['', '', '', '', ''],
    ['', '', '', '', '']
];

// 濁点が使える文字のセット
const dakutenAvailable = new Set(['か', 'き', 'く', 'け', 'こ', 'さ', 'し', 'す', 'せ', 'そ', 'た', 'ち', 'つ', 'て', 'と', 'は', 'ひ', 'ふ', 'へ', 'ほ']);

// 半濁点が使える文字のセット
const handakutenAvailable = new Set(['は', 'ひ', 'ふ', 'へ', 'ほ']);

// 拗音・促音が使える文字のセット
const smallKanaAvailable = new Set(['あ', 'い', 'う', 'え', 'お', 'つ', 'や', 'ゆ', 'よ']);

// DOM要素
const textOutput = document.getElementById('textOutput');
const speakBtn = document.getElementById('speakBtn');
const clearBtn = document.getElementById('clearBtn');
const gojuonGrid = document.getElementById('gojuonGrid');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const saveSettings = document.getElementById('saveSettings');

// Web Speech API のチェック
const synth = window.speechSynthesis;
let currentMode = 'normal'; // normal, dakuten, handakuten, small
let kanaButtons = [];
let functionButtons = {};

// AudioContext（音声機能の有効化に使用）
let audioContext = null;

// 停留クリック関連
let dwellSettings = {
    enabled: false,
    dwellTime: 700,
    settleTime: 150,
    settleThreshold: 5,
    cooldownTime: 200
};
let dwellCooldown = false;
let lockedButton = null;
let lastMousePos = { x: 0, y: 0 };
let lastMoveTime = 0;
const HYSTERESIS_RATIO = 0.15; // ボタン幅の15%

// 各ボタンの停留状態を管理するマップ
const buttonDwellStates = new WeakMap();

// 50音ボタンの生成
function createGojuonButtons() {
    // 各列を左から右に配置（あ、か、さ...）
    for (let col = 0; col < gojuonTable.length; col++) {
        for (let row = 0; row < 5; row++) {
            const kana = gojuonTable[col][row];
            const button = document.createElement('button');

            if (kana && kana !== '') {
                button.className = 'kana-btn';
                button.textContent = kana;
                button.dataset.kana = kana;
                button.dataset.col = col;
                button.dataset.row = row;

                const clickHandler = (e) => {
                    initAudio(e); // Initialize audio on interaction
                    handleKanaClick(col, row);
                };

                button.addEventListener('click', clickHandler);
                setupDwellClick(button, clickHandler);

                kanaButtons.push(button);
            } else {
                button.className = 'kana-btn';
                button.style.opacity = '0';
                button.style.cursor = 'default';
                button.disabled = true;
            }

            gojuonGrid.appendChild(button);
        }
    }

    // 機能ボタンを最後に追加（左端の列になる）
    const functionLabels = ['゛', '゜', 'ぁ', 'ー', '<span class="material-icons">backspace</span>'];
    const functionTypes = ['dakuten', 'handakuten', 'small', 'chouon', 'backspace'];

    for (let row = 0; row < 5; row++) {
        const button = document.createElement('button');
        button.className = 'kana-btn function-btn';

        if (functionTypes[row] === 'backspace') {
            button.classList.add('backspace-btn');
        }

        button.innerHTML = functionLabels[row];
        button.dataset.function = functionTypes[row];

        const clickHandler = (e) => {
            initAudio(e); // Initialize audio on interaction
            handleFunctionClick(functionTypes[row]);
        };

        button.addEventListener('click', clickHandler);
        setupDwellClick(button, clickHandler);

        functionButtons[functionTypes[row]] = button;
        gojuonGrid.appendChild(button);
    }
}

// 機能ボタンクリック処理
function handleFunctionClick(functionType) {
    if (functionType === 'backspace') {
        // バックスペース処理
        textOutput.value = textOutput.value.slice(0, -1);
        return;
    }


    if (functionType === 'chouon') {
        // 長音を直接入力
        textOutput.value += 'ー';
        speak('ー');
        return;
    }

    // モード切り替え
    if (currentMode === functionType) {
        // 同じボタンを押したらモード解除
        resetMode();
    } else {
        currentMode = functionType;
        updateButtonStates();
    }
}

// ボタンの状態を更新
function updateButtonStates() {
    // 全ての機能ボタンの active クラスを削除
    Object.values(functionButtons).forEach(btn => {
        btn.classList.remove('active');
    });

    // 現在のモードのボタンに active クラスを追加
    if (currentMode !== 'normal' && functionButtons[currentMode]) {
        functionButtons[currentMode].classList.add('active');
    }

    // かなボタンの状態を更新
    kanaButtons.forEach(button => {
        const kana = button.dataset.kana;
        const col = parseInt(button.dataset.col);
        const row = parseInt(button.dataset.row);

        let available = false;
        let displayKana = kana;

        switch (currentMode) {
            case 'dakuten':
                available = dakutenAvailable.has(kana);
                if (available) {
                    displayKana = dakutenTable[col][row];
                }
                break;
            case 'handakuten':
                available = handakutenAvailable.has(kana);
                if (available) {
                    displayKana = handakutenTable[col][row];
                }
                break;
            case 'small':
                available = smallKanaAvailable.has(kana);
                if (available) {
                    displayKana = smallKanaTable[col][row];
                }
                break;
            case 'normal':
                available = true;
                displayKana = kana;
                break;
        }

        if (available) {
            button.classList.remove('disabled');
            button.disabled = false;
            button.textContent = displayKana;
        } else {
            button.classList.add('disabled');
            button.disabled = true;
            button.textContent = kana; // 無効時は元の文字を表示
        }
    });
}

// モードをリセット
function resetMode() {
    currentMode = 'normal';
    updateButtonStates();
}

// 文字クリック処理
function handleKanaClick(col, row) {
    let kana = '';

    switch (currentMode) {
        case 'normal':
            kana = gojuonTable[col][row];
            break;
        case 'dakuten':
            kana = dakutenTable[col][row];
            break;
        case 'handakuten':
            kana = handakutenTable[col][row];
            break;
        case 'small':
            kana = smallKanaTable[col][row];
            break;
    }

    if (kana && kana !== '') {
        textOutput.value += kana;
        speak(kana);

        // 濁点・半濁点・拗音促音モードの場合は入力後に通常モードに戻る
        if (currentMode !== 'normal') {
            resetMode();
        }
    }
}

// 音声読み上げの初期化状態
let speechReady = false;
let speechInitialized = false;
let audioInitialized = false;
let selectedVoiceName = ''; // 選択された音声の名前

// DOM要素（追加）
const voiceSelect = document.getElementById('voiceSelect');

// 音声リストを初期化
function initSpeech() {
    if ('speechSynthesis' in window) {
        populateVoiceList();

        // Chromeなどの非同期読み込み対応
        if (typeof synth.onvoiceschanged !== 'undefined') {
            synth.onvoiceschanged = populateVoiceList;
        }
    }
}

// 音声リストをプルダウンに設定
function populateVoiceList() {
    if (!voiceSelect) return;

    // 現在の選択値を保持
    const currentSelected = voiceSelect.value || selectedVoiceName;
    voiceSelect.innerHTML = '';

    const voices = synth.getVoices().sort(function (a, b) {
        const aname = a.name.toUpperCase();
        const bname = b.name.toUpperCase();
        if (aname < bname) return -1;
        else if (aname == bname) return 0;
        else return +1;
    });

    const japaneseVoices = voices.filter(voice => voice.lang === 'ja-JP' || voice.lang.startsWith('ja'));

    if (japaneseVoices.length === 0) {
        const option = document.createElement('option');
        option.textContent = '日本語音声が見つかりません';
        option.disabled = true;
        voiceSelect.appendChild(option);
        return;
    }

    speechReady = true;

    // デフォルト（自動選択）オプション
    const defaultOption = document.createElement('option');
    defaultOption.textContent = '自動選択';
    defaultOption.value = '';
    voiceSelect.appendChild(defaultOption);

    japaneseVoices.forEach((voice) => {
        const option = document.createElement('option');
        let label = voice.name;

        // オフラインで使える可能性が高いもの（localServiceがtrue）にマークをつける
        if (voice.localService) {
            label += ' (本体内蔵)';
        }

        option.textContent = label;
        option.value = voice.name;

        // 保存されていた設定と一致するかチェック
        if (currentSelected && voice.name === currentSelected) {
            option.selected = true;
        }

        voiceSelect.appendChild(option);
    });
}

// 音声が選択された時の処理
if (voiceSelect) {
    voiceSelect.addEventListener('change', () => {
        selectedVoiceName = voiceSelect.value;
        // 試し聴きなどはしない（ユーザーの操作を邪魔しないため）
    });
}

// スクリーンロックの防止
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            const wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('Wake lock released');
            });
            console.log('Wake lock acquired');
        }
    } catch (err) {
        console.error('Wake lock error:', err);
    }
}

// 再表示時にWake lockを再取得
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// 音声初期化（ユーザー操作時に一度だけ実行）
function initAudio(e) {
    if (audioInitialized || speechInitialized) return;

    // イベントがあり、かつ信頼できない（スクリプト生成の）イベントの場合は初期化完了とみなさない
    if (e && !e.isTrusted) {
        console.log('Skipping audio init on untrusted event');
        return;
    }

    // 信頼できるイベント、またはイベント引数がない場合（念のため）は初期化を試みる
    audioInitialized = true;
    speechInitialized = true;

    try {
        const u = new SpeechSynthesisUtterance('');
        window.speechSynthesis.speak(u);
        requestWakeLock();
        console.log('Audio initialized with trusted event');
    } catch (e) {
        console.error('Init audio error:', e);
    }

    document.body.removeEventListener('touchstart', initAudio);
    document.body.removeEventListener('click', initAudio);
    document.removeEventListener('keydown', initAudio);
}

// 最初のタッチ、クリック、キー入力で音声を初期化
document.body.addEventListener('touchstart', initAudio);
document.body.addEventListener('click', initAudio);
document.addEventListener('keydown', initAudio);

// 音声機能が初期化済みかチェック（もはや不要だが後方互換のため残す）
function ensureSpeechInitialized() {
    // initAudio()は最初のクリック/タッチで自動的に呼ばれるため、何もしない
    return speechInitialized;
}

// 音声読み上げ（1文字）
function speak(text) {
    if ('speechSynthesis' in window) {
        // Chromeでの問題を回避：既存の読み上げを完全に停止
        synth.cancel();

        // 少し遅延させてから読み上げを開始（Chromeのバグ回避）
        setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'ja-JP';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            // 音声の選択
            const voices = synth.getVoices();
            let voiceToUse = null;

            if (selectedVoiceName) {
                // ユーザーが選択した音声を探す
                voiceToUse = voices.find(voice => voice.name === selectedVoiceName);
            }

            // 見つからなかった場合、または未選択の場合はデフォルト（日本語優先）
            if (!voiceToUse) {
                voiceToUse = voices.find(voice => voice.lang === 'ja-JP' || voice.lang.startsWith('ja'));
            }

            if (voiceToUse) {
                utterance.voice = voiceToUse;
            }

            synth.speak(utterance);
        }, 10);
    }
}

// 全文読み上げ
function speakAll(e) {
    initAudio(e); // Initialize audio on interaction

    const text = textOutput.value;
    if (text.trim() === '') {
        return;
    }

    if ('speechSynthesis' in window) {
        // 既存の読み上げを停止
        if (synth.speaking) {
            synth.cancel();
        }

        setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'ja-JP';
            utterance.rate = 0.9;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            // 音声の選択
            const voices = synth.getVoices();
            let voiceToUse = null;

            if (selectedVoiceName) {
                voiceToUse = voices.find(voice => voice.name === selectedVoiceName);
            }

            if (!voiceToUse) {
                voiceToUse = voices.find(voice => voice.lang === 'ja-JP' || voice.lang.startsWith('ja'));
            }

            if (voiceToUse) {
                utterance.voice = voiceToUse;
            }

            synth.speak(utterance);
        }, 10);
    }
}


// クリア処理
function clearText(e) {
    initAudio(e); // Initialize audio on interaction
    textOutput.value = '';
    synth.cancel();
}

// 停留クリックの設定
function setupDwellClick(button, clickHandler) {
    // このボタン専用の状態を作成
    const state = {
        indicator: null,
        progress: null,
        isSettled: false,
        settleTimer: null,
        dwellTimer: null
    };

    buttonDwellStates.set(button, state);

    button.addEventListener('mouseenter', (e) => {
        // マウスホバーはTrustedだが、音声再生の権限としては弱いためinitAudioは呼ばない

        if (!dwellSettings.enabled || dwellCooldown || button.disabled) return;

        // 既に別のボタンがロックされている場合は何もしない
        if (lockedButton && lockedButton !== button) return;

        // このボタンをロック
        lockedButton = button;
        state.isSettled = false;
        lastMousePos = { x: e.clientX, y: e.clientY };
        lastMoveTime = Date.now();

        // 安定待機タイマー開始
        state.settleTimer = setTimeout(() => {
            state.isSettled = true;
            startDwellProgress();
        }, dwellSettings.settleTime);
    });

    button.addEventListener('mousemove', (e) => {
        if (!dwellSettings.enabled || dwellCooldown || button.disabled) return;

        const currentTime = Date.now();
        const deltaTime = currentTime - lastMoveTime;

        if (deltaTime > 0) {
            const deltaX = e.clientX - lastMousePos.x;
            const deltaY = e.clientY - lastMousePos.y;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            const speed = (distance / deltaTime) * 1000; // ピクセル/秒

            // 速度が閾値を超えたら安定タイマーをリセット
            if (speed > dwellSettings.settleThreshold) {
                if (state.settleTimer) {
                    clearTimeout(state.settleTimer);
                    state.settleTimer = null;
                }
                if (state.dwellTimer && !state.isSettled) {
                    // まだ安定していない場合は停留タイマーもリセット
                    cleanupDwellProgress();
                }

                state.isSettled = false;

                // 安定待機タイマーを再開
                state.settleTimer = setTimeout(() => {
                    state.isSettled = true;
                    startDwellProgress();
                }, dwellSettings.settleTime);
            }
        }

        lastMousePos = { x: e.clientX, y: e.clientY };
        lastMoveTime = currentTime;
    });

    button.addEventListener('mouseleave', () => {
        if (!dwellSettings.enabled) return;

        // ロックされていない場合は即座にクリーンアップ
        if (lockedButton !== button) {
            cleanupDwell();
        }
        // ロックされている場合は、グローバルハンドラで処理される
    });

    function startDwellProgress() {
        // すでにプログレスが開始されている場合は何もしない
        if (state.indicator) return;

        // インジケーターを作成
        state.indicator = document.createElement('div');
        state.indicator.className = 'dwell-indicator';
        state.progress = document.createElement('div');
        state.progress.className = 'dwell-progress';

        state.indicator.appendChild(state.progress);
        button.style.position = 'relative';
        button.appendChild(state.indicator);

        // 確実に0%から開始するため、setTimeoutで少し遅延
        setTimeout(() => {
            if (!state.progress) return;

            // 初期状態を明示的に設定
            state.progress.style.width = '0%';
            state.progress.style.transition = 'none';

            // 強制リフロー
            void state.progress.offsetWidth;

            // トランジションを開始
            state.progress.style.transition = `width ${dwellSettings.dwellTime}ms linear`;
            state.progress.style.width = '100%';
        }, 10);

        // 停留タイマー
        state.dwellTimer = setTimeout(() => {
            // 実際のクリックイベントを発火させる（ユーザージェスチャーとして認識される可能性）
            try {
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                button.dispatchEvent(clickEvent);
            } catch (e) {
                // フォールバック: 直接ハンドラを呼ぶ
                clickHandler();
            }
            cleanupDwell();

            // クールダウン開始
            dwellCooldown = true;
            setTimeout(() => {
                dwellCooldown = false;
            }, dwellSettings.cooldownTime);
        }, dwellSettings.dwellTime);
    }

    function cleanupDwellProgress() {
        if (state.dwellTimer) {
            clearTimeout(state.dwellTimer);
            state.dwellTimer = null;
        }
        if (state.indicator && state.indicator.parentNode) {
            state.indicator.parentNode.removeChild(state.indicator);
            state.indicator = null;
            state.progress = null;
        }
    }

    function cleanupDwell() {
        if (state.settleTimer) {
            clearTimeout(state.settleTimer);
            state.settleTimer = null;
        }
        cleanupDwellProgress();
        if (lockedButton === button) {
            lockedButton = null;
        }
        state.isSettled = false;
    }
}

// 設定モーダルの制御
settingsBtn.addEventListener('click', (e) => {
    initAudio(e); // Initialize audio on interaction
    settingsModal.classList.add('active');
    loadSettings();
});

closeSettings.addEventListener('click', () => {
    settingsModal.classList.remove('active');
});

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.remove('active');
    }
});

saveSettings.addEventListener('click', () => {
    saveSettingsToStorage();
    settingsModal.classList.remove('active');
});

// 設定の読み込み
function loadSettings() {
    const stored = localStorage.getItem('dwellSettings');
    if (stored) {
        dwellSettings = JSON.parse(stored);
    }

    // 音声設定の読み込み
    const storedVoice = localStorage.getItem('voiceName');
    if (storedVoice) {
        selectedVoiceName = storedVoice;
        // プルダウンが既に生成されていれば選択を反映
        if (voiceSelect && voiceSelect.options.length > 1) {
            voiceSelect.value = selectedVoiceName;
        }
    }

    document.getElementById('dwellClickEnabled').checked = dwellSettings.enabled;
    document.getElementById('dwellTime').value = dwellSettings.dwellTime;
    document.getElementById('settleTime').value = dwellSettings.settleTime;
    document.getElementById('settleThreshold').value = dwellSettings.settleThreshold;
    document.getElementById('cooldownTime').value = dwellSettings.cooldownTime;
    document.getElementById('dwellTimeValue').textContent = dwellSettings.dwellTime + 'ms';
    document.getElementById('settleTimeValue').textContent = dwellSettings.settleTime + 'ms';
    document.getElementById('settleThresholdValue').textContent = dwellSettings.settleThreshold + 'px/s';
    document.getElementById('cooldownTimeValue').textContent = dwellSettings.cooldownTime + 'ms';
}

// 設定の保存
function saveSettingsToStorage() {
    dwellSettings.enabled = document.getElementById('dwellClickEnabled').checked;
    dwellSettings.dwellTime = parseInt(document.getElementById('dwellTime').value);
    dwellSettings.settleTime = parseInt(document.getElementById('settleTime').value);
    dwellSettings.settleThreshold = parseInt(document.getElementById('settleThreshold').value);
    dwellSettings.cooldownTime = parseInt(document.getElementById('cooldownTime').value);

    localStorage.setItem('dwellSettings', JSON.stringify(dwellSettings));

    // 音声設定の保存
    localStorage.setItem('voiceName', selectedVoiceName);
}

// 設定値のリアルタイム更新
document.getElementById('dwellTime').addEventListener('input', (e) => {
    document.getElementById('dwellTimeValue').textContent = e.target.value + 'ms';
});

document.getElementById('settleTime').addEventListener('input', (e) => {
    document.getElementById('settleTimeValue').textContent = e.target.value + 'ms';
});

document.getElementById('settleThreshold').addEventListener('input', (e) => {
    document.getElementById('settleThresholdValue').textContent = e.target.value + 'px/s';
});

document.getElementById('cooldownTime').addEventListener('input', (e) => {
    document.getElementById('cooldownTimeValue').textContent = e.target.value + 'ms';
});


// グローバルマウスムーブイベントでヒステリシスを処理
document.addEventListener('mousemove', (e) => {
    if (!dwellSettings.enabled || !lockedButton) return;

    const rect = lockedButton.getBoundingClientRect();
    const hysteresisMargin = Math.min(rect.width, rect.height) * HYSTERESIS_RATIO;

    // ヒステリシスマージンを含めた拡張領域
    const extendedRect = {
        left: rect.left - hysteresisMargin,
        right: rect.right + hysteresisMargin,
        top: rect.top - hysteresisMargin,
        bottom: rect.bottom + hysteresisMargin
    };

    // マウスが拡張領域の外に出たらロックを解除
    if (e.clientX < extendedRect.left ||
        e.clientX > extendedRect.right ||
        e.clientY < extendedRect.top ||
        e.clientY > extendedRect.bottom) {

        // 別のボタン上にいるかチェック
        const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
        const newButton = elementUnderMouse?.closest('.kana-btn, .control-btn');

        if (newButton && newButton !== lockedButton && !newButton.disabled) {
            // 新しいボタンに切り替え
            unlockButton();
        } else if (!newButton) {
            // ボタンの外に出た
            unlockButton();
        }
    }
});

function unlockButton() {
    if (lockedButton) {
        const state = buttonDwellStates.get(lockedButton);

        if (state) {
            // タイマーをクリア
            if (state.settleTimer) {
                clearTimeout(state.settleTimer);
                state.settleTimer = null;
            }
            if (state.dwellTimer) {
                clearTimeout(state.dwellTimer);
                state.dwellTimer = null;
            }

            // プログレスインジケーターを削除
            if (state.indicator && state.indicator.parentNode) {
                state.indicator.parentNode.removeChild(state.indicator);
                state.indicator = null;
                state.progress = null;
            }

            state.isSettled = false;
        }

        lockedButton = null;
    }
}

// イベントリスナー
speakBtn.addEventListener('click', speakAll);
clearBtn.addEventListener('click', (e) => {
    initAudio(e);
    clearText(e);
});

// 読み上げとクリアボタンに停留クリックを設定
setupDwellClick(speakBtn, speakAll);
setupDwellClick(clearBtn, (e) => {
    initAudio(e);
    clearText(e);
});


// 初期化
initSpeech();
createGojuonButtons();
loadSettings();
