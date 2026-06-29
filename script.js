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

                button.addEventListener('click', (e) => {
                    initAudio(e);
                    handleKanaClick(col, row);
                });

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

        button.addEventListener('click', (e) => {
            initAudio(e);
            handleFunctionClick(functionTypes[row]);
        });

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

    if (e && !e.isTrusted) {
        console.log('Skipping audio init on untrusted event');
        return;
    }

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

// 音声読み上げ（1文字）
function speak(text) {
    if ('speechSynthesis' in window) {
        synth.cancel();

        setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'ja-JP';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

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

// 全文読み上げ
function speakAll(e) {
    initAudio(e);

    const text = textOutput.value;
    if (text.trim() === '') {
        return;
    }

    if ('speechSynthesis' in window) {
        if (synth.speaking) {
            synth.cancel();
        }

        setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'ja-JP';
            utterance.rate = 0.9;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

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
    initAudio(e);
    textOutput.value = '';
    synth.cancel();
}

// 設定モーダルの制御
settingsBtn.addEventListener('click', (e) => {
    initAudio(e);
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
    const storedVoice = localStorage.getItem('voiceName');
    if (storedVoice) {
        selectedVoiceName = storedVoice;
        if (voiceSelect && voiceSelect.options.length > 1) {
            voiceSelect.value = selectedVoiceName;
        }
    }
}

// 設定の保存
function saveSettingsToStorage() {
    localStorage.setItem('voiceName', selectedVoiceName);
}

// イベントリスナー
speakBtn.addEventListener('click', speakAll);
clearBtn.addEventListener('click', (e) => {
    initAudio(e);
    clearText(e);
});

// 初期化
initSpeech();
createGojuonButtons();
loadSettings();
