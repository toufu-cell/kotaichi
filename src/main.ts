import './style.css';
import data from './data/pokemon.json';
import { validateIVs, type Pokemon, type IVs } from './ranking.ts';
import { loadImage, scanImage } from './scanner.ts';
import { SOURCE_URL, type RankResponse } from './api.ts';

const catalog: Pokemon[] = data.pokemon;
const app = document.querySelector<HTMLDivElement>('#app')!;
const icon = (name: 'upload' | 'shield' | 'arrow' | 'check') => ({
    upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
}[name]);
const svg = (name: Parameters<typeof icon>[0]) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon(name)}</svg>`;

app.innerHTML = `
    <header class="header"><a class="brand" href="/" aria-label="個体値スコープ ホーム"><img src="/icon.svg" alt="" width="34" height="34"><span>個体値スコープ<small>POKÉMON GO · IV CHECKER</small></span></a><a class="help-link" href="#about">順位について <span aria-hidden="true">↗</span></a></header>
    <main>
        <section class="intro"><div><p class="eyebrow">その1匹の、可能性を見つけよう。</p><h1>スクショから、<br class="mobile-break">育てたい1匹へ。</h1><p class="lead">個体値を読み取って、リーグごとの順位をチェック。<br class="desktop-break">進化先の個体値順位も、まとめて見比べられます。</p></div><div class="privacy">${svg('shield')}<span>画像は端末の中で処理<small>画像の送信・アカウント登録は不要</small></span></div></section>
        <div class="workspace">
            <section class="scan-panel" aria-labelledby="scan-heading">
                <div class="section-heading"><h2 id="scan-heading">評価画面を読み取る</h2><span class="step-note">画像から自動入力</span></div>
                <label class="dropzone" id="dropzone" for="image-file"><input type="file" id="image-file" accept="image/png,image/jpeg,image/webp"><span class="upload-icon">${svg('upload')}</span><strong>スクリーンショットを選ぶ</strong><span>または、ここにドラッグ＆ドロップ</span><small>PNG / JPEG / WebP · 20MBまで</small></label>
                <p class="upload-privacy">画像を外部に送信せず、端末内で読み取ります。</p>
                <div class="scan-status" role="status" aria-live="polite" id="scan-status"></div><button class="text-button" id="cancel-scan" hidden>読み取りを中止</button>
                <div class="preview" id="preview" hidden><canvas id="preview-canvas" aria-label="選択した評価画面。読み取り結果と見比べてください。"></canvas><p>読み取った個体値を、元の画像と見比べてください。</p></div>
                <div class="appraisal-guide" id="appraisal-guide"><div class="guide-bars" aria-hidden="true"><span style="--fill:73%"></span><span style="--fill:93%"></span><span style="--fill:86%"></span></div><div><strong>3本の評価バーを写してください</strong><p>「ポケモンを調べてもらう」を開き、<br>名前と評価バーが見える画面を撮影します。</p></div></div>
                <div class="sample-row"><span>まずは使い方を確認</span><button class="text-button" id="sample-button">入力例で試す ${svg('arrow')}</button></div>
                <form id="iv-form" novalidate>
                    <div class="section-heading form-heading"><h2>読み取り内容を確認</h2><span class="step-note">手入力もできます</span></div>
                    <label class="field-label" for="pokemon">ポケモン・フォルム</label><input type="search" id="pokemon" list="pokemon-list" placeholder="例：デルビル、マリルリ" autocomplete="off" required aria-describedby="pokemon-help"><datalist id="pokemon-list"></datalist><p id="pokemon-help" class="field-help">名前を入力して候補を選択。別フォルムは個別に選べます。</p><div id="name-candidates" class="name-candidates"></div>
                    <div class="iv-fields">${['こうげき', 'ぼうぎょ', 'HP'].map((label, index) => `<div><label for="iv-${index}">${label}</label><div class="number-field"><input id="iv-${index}" type="number" min="0" max="15" step="1" inputmode="numeric" placeholder="—" required><span>/ 15</span></div><div class="mini-bar" id="bar-${index}" aria-hidden="true"><span></span></div></div>`).join('')}</div>
                    <label class="field-label access-label" for="access-code">利用コード</label><input type="password" id="access-code" autocomplete="current-password" aria-describedby="access-help"><p id="access-help" class="field-help">管理者から受け取ったコードを入力してください。アカウント登録は不要です。</p>
                    <p class="field-help">順位の取得時に、ポケモン名と個体値を送信します。画像は送信しません。</p>
                    <div class="form-error" role="alert" id="form-error"></div><button class="primary-button" type="submit">この個体値で順位を調べる ${svg('arrow')}</button>
                </form>
            </section>
            <section class="results-panel" aria-labelledby="results-heading">
                <div class="section-heading"><h2 id="results-heading">PvP個体値順位</h2><a class="calculation-tag" href="${SOURCE_URL}" target="_blank" rel="noreferrer">計算に使うデータ ↗</a></div>
                <div class="league-tabs" role="group" aria-label="リーグ">${[['1500', 'スーパー', 'CP 1,500'], ['2500', 'ハイパー', 'CP 2,500'], ['500', 'リトル', 'CP 500'], ['Infinity', 'マスター', 'CP制限なし']].map(([cap, label, sub]) => `<button type="button" data-cap="${cap}" aria-pressed="${cap === '1500'}"><strong>${label}</strong><small>${sub}</small></button>`).join('')}</div>
                <div class="settings"><label for="max-level">育成レベル上限</label><select id="max-level"><option value="50">PL 50（アメXLあり）</option><option value="40">PL 40（アメXLなし）</option><option value="51">PL 51（最高の相棒）</option></select></div>
                <div id="results" aria-live="polite"><div class="empty-state"><div class="rank-outline" aria-hidden="true"><span>RANK</span><strong>—<small>位</small></strong><div class="empty-bars"><i></i><i></i><i></i></div></div><h3>この1匹は、何位だろう。</h3><p>画像を選ぶか、個体値を入力すると<br>育成後の順位と進化先の比較が表示されます。</p></div></div>
                <p class="results-note">順位は同じポケモン・フォルムの中での理論値です。<br>対戦の勝率や、ポケモン同士の強さの順位ではありません。<br>現在のCPは未判定です。CP上限を超えた個体は参加できません。</p>
            </section>
        </div>
        <section class="about" id="about"><h2>順位の見方</h2><div class="about-content"><div><h3>個体値100%が、いつも1位とは限らない。</h3><p>CP制限のある対戦では、こうげきが低い個体ほどレベルを上げられることがあります。本アプリで能力値の積を計算し、リーグごとの個体値順位を表示します。</p></div><div><details><summary>計算条件と対応範囲</summary><p>個体値0〜15の全4,096通りを、こうげき・ぼうぎょ・HPの積で比較します。同率は同順位です。育成レベル上限は40・50・51です。CP制限内で育成できる最大レベルの順位・CPを表示します。</p><p>現在のCP・レベルは判定しません。すでにCP上限を超えた個体は、そのリーグでは使えません。技、シャドウ補正、限定カップの参加条件は判定しません。進化候補の性別・地域・イベントなどの条件は確認が必要です。</p><p>日本語の評価画面に対応します。ニックネームや画面デザインの違いで読めない場合は手入力してください。画像は保存・送信しません。計算結果は最大24時間再利用します。</p></details><details><summary>データと出典</summary><p id="data-info"></p><p>種族値・進化候補・レベル補正：<a href="${SOURCE_URL}" target="_blank" rel="noreferrer">PvPoke</a>（<a href="/licenses/pvpoke.txt">MIT</a>）<br>日本語名：<a href="https://pokeapi.co/" target="_blank" rel="noreferrer">PokéAPI</a>（<a href="/licenses/pokeapi.txt">ライセンス</a>）<br>文字認識：<a href="https://github.com/naptha/tesseract.js" target="_blank" rel="noreferrer">Tesseract.js</a></p></details></div></div></section>
    </main><footer><span>個体値スコープ</span><p>Pokémon GOの非公式ファンツールです。<br>Pokémonおよび関連名称は各権利者に帰属します。</p></footer>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const pokemonInput = $<HTMLInputElement>('#pokemon');
const ivInputs = [0, 1, 2].map(index => $<HTMLInputElement>(`#iv-${index}`));
const fileInput = $<HTMLInputElement>('#image-file');
const maxLevelInput = $<HTMLSelectElement>('#max-level');
const resultElement = $('#results');
const emptyMarkup = resultElement.innerHTML;
let selectedCap = 1500;
let confirmed: { pokemon: Pokemon; ivs: IVs } | null = null;
let scanController: AbortController | null = null;
let isBusy = false;
let rankController: AbortController | null = null;
let remoteResult: RankResponse | null = null;
const resultsCache = new Map<string, RankResponse>();

for (const pokemon of catalog) {
    const option = document.createElement('option');
    option.value = pokemon.label;
    option.textContent = `No.${pokemon.dex.toString().padStart(4, '0')} / ${pokemon.englishName}`;
    $('#pokemon-list').append(option);
}
$('#data-info').textContent = `データ更新：${data.gameMasterDate.slice(0, 10)}。${catalog.length.toLocaleString()}種・フォルムを収録。データは固定版を使用しています。`;

function setStatus(text: string, error = false) {
    $('#scan-status').textContent = text;
    $('#scan-status').classList.toggle('error', error);
}

function updateBars() {
    ivInputs.forEach((input, index) => {
        const value = Number(input.value);
        $(`#bar-${index}`).style.setProperty('--fill', `${Math.min(100, Math.max(0, value / 15 * 100))}%`);
    });
}

function invalidate() {
    rankController?.abort();
    rankController = null;
    remoteResult = null;
    resultElement.removeAttribute('aria-busy');
    $<HTMLButtonElement>('#iv-form button[type=submit]').disabled = isBusy;
    confirmed = null;
    resultElement.innerHTML = emptyMarkup;
    $('#form-error').textContent = '';
    updateBars();
}

function renderResults() {
    if (!confirmed || !remoteResult) return;
    const { pokemon, ivs } = confirmed;
    const result = remoteResult;
    const family = result.rows.filter(row => row.cap === (Number.isFinite(selectedCap) ? selectedCap : null) && row.maxLevel === Number(maxLevelInput.value));
    family.sort((a, b) => Number(b.sourceId === result.sourceId) - Number(a.sourceId === result.sourceId)
        || Number(/^(メガ|ゲンシ)/.test(a.name)) - Number(/^(メガ|ゲンシ)/.test(b.name)));
    resultElement.replaceChildren();
    const summary = document.createElement('div');
    summary.className = 'result-summary';
    summary.textContent = `${pokemon.label} · ${ivs.join(' / ')} · 計算：${new Date(result.fetchedAt).toLocaleString('ja-JP')}`;
    resultElement.append(summary);
    for (const [index, entry] of family.entries()) {
        const card = document.createElement('article');
        card.className = `result-card ${index === 0 ? 'current' : ''}`;
        const heading = document.createElement('h3');
        heading.textContent = entry.name;
        const cardTop = document.createElement('div');
        cardTop.className = 'card-top';
        const identity = document.createElement('div');
        const stage = document.createElement('p');
        stage.className = 'stage-label';
        stage.textContent = index === 0 ? 'このポケモン' : '進化候補';
        identity.append(stage, heading);
        cardTop.append(identity);
        card.append(cardTop);
        const details = document.createElement('div');
        details.innerHTML = '<div class="rank-line"><div class="rank"><strong></strong><span>位</span></div></div><dl class="result-stats"></dl>';
        details.querySelector('.rank strong')!.textContent = entry.rank.toLocaleString();
        for (const [label, value] of [['育成後CP', entry.cp], ['ポケモンレベル', entry.level], ['SCP', entry.scp]] as const) {
            if (label === 'SCP' && value === null) continue;
            const group = document.createElement('div');
            const term = document.createElement('dt');
            const description = document.createElement('dd');
            term.textContent = label;
            description.textContent = value?.toLocaleString() ?? '—';
            group.append(term, description);
            details.querySelector('dl')!.append(group);
        }
        card.append(details);
        resultElement.append(card);
    }
}

async function fetchResults() {
    if (!confirmed) return;
    const current = confirmed;
    const key = `${current.pokemon.id}:${current.ivs.join('-')}`;
    const cached = resultsCache.get(key);
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < 86400000) {
        remoteResult = cached;
        renderResults();
        return;
    }
    const code = $<HTMLInputElement>('#access-code').value;
    if (!code) { $('#form-error').textContent = '利用コードを入力してください。'; $('#access-code').focus(); return; }
    const controller = new AbortController();
    rankController?.abort();
    rankController = controller;
    remoteResult = null;
    resultElement.textContent = '順位を計算しています…';
    resultElement.setAttribute('aria-busy', 'true');
    const submit = $<HTMLButtonElement>('#iv-form button[type=submit]');
    submit.disabled = true;
    const timeout = setTimeout(() => controller.abort(), 75000);
    try {
        const response = await fetch('/api/rank', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${code}` },
            body: JSON.stringify({ pokemonId: current.pokemon.id, ivs: current.ivs }), signal: controller.signal,
        });
        if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('順位取得用のサーバーが見つかりません。管理者に公開設定を確認してください。');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '順位を取得できませんでした。');
        if (result.request?.pokemonId !== current.pokemon.id || JSON.stringify(result.request?.ivs) !== JSON.stringify(current.ivs)
            || !Array.isArray(result.rows) || result.rows.length === 0 || !Number.isFinite(Date.parse(result.fetchedAt))) throw new Error('取得結果を確認できませんでした。もう一度お試しください。');
        if (controller.signal.aborted || confirmed !== current) return;
        if (resultsCache.size >= 20) resultsCache.delete(resultsCache.keys().next().value!);
        resultsCache.set(key, result);
        remoteResult = result;
        renderResults();
    } catch (error) {
        if (rankController !== controller || confirmed !== current) return;
        resultElement.textContent = controller.signal.aborted ? '取得が時間内に終わりませんでした。時間をおいて再度お試しください。' : (error as Error).message;
        const link = document.createElement('a');
        link.href = SOURCE_URL; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = '計算に使うデータ ↗'; link.className = 'text-button';
        resultElement.append(document.createElement('br'), link);
    } finally {
        clearTimeout(timeout);
        if (rankController === controller) {
            rankController = null;
            resultElement.removeAttribute('aria-busy');
            submit.disabled = isBusy;
        }
    }
}

$('#iv-form').addEventListener('submit', event => {
    event.preventDefault();
    const pokemon = catalog.find(entry => entry.label === pokemonInput.value.trim());
    const ivs = ivInputs.map(input => input.value === '' ? NaN : Number(input.value)) as IVs;
    try {
        if (!pokemon) { pokemonInput.focus(); throw new Error('候補からポケモン・フォルムを選んでください。'); }
        validateIVs(ivs);
        confirmed = { pokemon, ivs };
        $('#form-error').textContent = '';
        void fetchResults();
        if (window.matchMedia('(max-width: 760px)').matches) $('.results-panel').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    } catch (error) {
        $('#form-error').textContent = (error as Error).message;
    }
});

[pokemonInput, ...ivInputs, $('#access-code')].forEach(input => input.addEventListener('input', invalidate));
maxLevelInput.addEventListener('change', renderResults);
document.querySelectorAll<HTMLButtonElement>('[data-cap]').forEach(button => button.addEventListener('click', () => {
    selectedCap = Number(button.dataset.cap);
    document.querySelectorAll<HTMLButtonElement>('[data-cap]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
    renderResults();
}));

async function processFile(file: File) {
    if (isBusy) return;
    isBusy = true;
    scanController = new AbortController();
    fileInput.disabled = true;
    [pokemonInput, ...ivInputs, $<HTMLButtonElement>('#iv-form button[type=submit]')].forEach(input => { input.disabled = true; });
    $<HTMLButtonElement>('#sample-button').disabled = true;
    $<HTMLButtonElement>('#cancel-scan').hidden = false;
    $('#dropzone').classList.add('busy');
    pokemonInput.value = '';
    ivInputs.forEach(input => { input.value = ''; });
    $('#name-candidates').replaceChildren();
    $('#preview').hidden = true;
    $('#appraisal-guide').hidden = false;
    invalidate();
    setStatus('画像を開いています…');
    try {
        const canvas = await loadImage(file);
        if (scanController.signal.aborted) return;
        const preview = $<HTMLCanvasElement>('#preview-canvas');
        preview.width = canvas.width;
        preview.height = canvas.height;
        preview.getContext('2d')!.drawImage(canvas, 0, 0);
        $('#preview').hidden = false;
        $('#appraisal-guide').hidden = true;
        const result = await scanImage(canvas, catalog, message => setStatus(message), scanController.signal);
        if (scanController.signal.aborted) return;
        if (result.detection) result.detection.ivs.forEach((value, index) => { ivInputs[index].value = String(value); });
        if (result.candidates.length === 1) pokemonInput.value = result.candidates[0].label;
        else if (result.candidates.length > 1) {
            const note = document.createElement('p');
            note.textContent = 'フォルムは画像だけでは確定できません。該当するものを選んでください。';
            $('#name-candidates').append(note);
            for (const candidate of result.candidates) {
                const button = document.createElement('button');
                button.type = 'button'; button.textContent = candidate.label;
                button.addEventListener('click', () => { pokemonInput.value = candidate.label; invalidate(); });
                $('#name-candidates').append(button);
            }
        }
        updateBars();
        const messages = [];
        if (!result.detection) messages.push('評価バーを読み取れませんでした。個体値を手入力してください。');
        if (!result.candidates.length) messages.push(result.nameError || '名前を特定できませんでした。候補から選んでください。');
        if (messages.length) setStatus(messages.join(' '), true);
        else setStatus('読み取りが終わりました。画像と数値を確認して、順位を調べてください。');
    } catch (error) {
        setStatus((error as Error).message || '画像を開けませんでした。別の画像を選んでください。', true);
    } finally {
        isBusy = false;
        scanController = null;
        fileInput.disabled = false;
        [pokemonInput, ...ivInputs, $<HTMLButtonElement>('#iv-form button[type=submit]')].forEach(input => { input.disabled = false; });
        fileInput.value = '';
        $<HTMLButtonElement>('#sample-button').disabled = false;
        $<HTMLButtonElement>('#cancel-scan').hidden = true;
        $('#dropzone').classList.remove('busy');
    }
}

fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void processFile(file); });
$('#cancel-scan').addEventListener('click', () => { scanController?.abort(); setStatus('読み取りを中止しました。別の画像を選ぶか、手入力してください。'); });
$('#dropzone').addEventListener('dragover', event => { event.preventDefault(); if (!isBusy) $('#dropzone').classList.add('dragging'); });
$('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('dragging'));
$('#dropzone').addEventListener('drop', event => {
    event.preventDefault(); $('#dropzone').classList.remove('dragging');
    const file = (event as DragEvent).dataTransfer?.files[0]; if (file) void processFile(file);
});
$('#sample-button').addEventListener('click', () => {
    pokemonInput.value = 'デルビル';
    [8, 3, 11].forEach((value, index) => { ivInputs[index].value = String(value); });
    $('#name-candidates').replaceChildren();
    $('#preview').hidden = true;
    $('#appraisal-guide').hidden = false;
    invalidate();
    setStatus('入力例：デルビルの8 / 3 / 11を入力しました。順位を調べてみましょう。');
    pokemonInput.focus();
});
