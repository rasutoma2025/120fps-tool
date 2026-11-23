(function () {
  const { FFmpeg } = FFmpegWASM;
  const { fetchFile } = FFmpegUtil;

  const ffmpeg = new FFmpeg();
  let engineReady = false;
  let busy = false;
  let objectUrl = null;

  const $ = (id) => document.getElementById(id);
  const dropzone = $('dropzone');
  const fileInput = $('fileInput');
  const progressPanel = $('progressPanel');
  const progressText = $('progressText');
  const progressValue = $('progressValue');
  const progressBar = $('progressBar');
  const errorBox = $('errorBox');
  const resultPanel = $('resultPanel');
  const resultInfo = $('resultInfo');
  const downloadLink = $('downloadLink');
  const againBtn = $('againBtn');

  function setProgress(pct) {
    const v = Math.max(0, Math.min(100, Math.round(pct || 0)));
    progressBar.style.width = v + '%';
    progressValue.textContent = v + '%';
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function resetUI() {
    errorBox.hidden = true;
    resultPanel.hidden = true;
    progressPanel.hidden = true;
    setProgress(0);
    fileInput.value = '';
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  async function ensureEngine() {
    if (engineReady) return;
    progressPanel.hidden = false;
    progressText.textContent = 'エンジンを読み込み中…（初回のみ）';
    setProgress(0);

    ffmpeg.on('progress', ({ progress }) => {
      if (typeof progress === 'number' && Number.isFinite(progress)) {
        setProgress(progress * 100);
      }
    });

    await ffmpeg.load();   // シングルスレッド版：COOP/COEP 不要
    engineReady = true;
  }

  async function processFile(file) {
    if (busy || !file) return;
    busy = true;
    resetUI();
    dropzone.classList.add('is-busy');
    dropzone.setAttribute('aria-busy', 'true');

    const startedAt = performance.now();

    try {
      await ensureEngine();

      progressText.textContent = '変換中…';
      setProgress(0);

      const extMatch = file.name.match(/\.[^.]+$/);
      const inName = 'input' + (extMatch ? extMatch[0].toLowerCase() : '.mp4');
      const outName = 'output.mp4';

      await ffmpeg.writeFile(inName, await fetchFile(file));

      // 縦→幅1080 / 横→高さ1080 / 正方形→1080x1080。クロップなし。
      await ffmpeg.exec([
        '-i', inName,
        '-vf', "scale='if(gt(iw,ih),-2,1080)':'if(gte(iw,ih),1080,-2)',fps=60",
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outName
      ]);

      const data = await ffmpeg.readFile(outName);
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      objectUrl = URL.createObjectURL(blob);

      const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
      resultInfo.textContent =
        formatSize(file.size) + ' → ' + formatSize(blob.size) + ' · ' + secs + '秒';
      downloadLink.href = objectUrl;
      downloadLink.setAttribute('download', file.name.replace(/\.[^.]+$/, '') + '-tomato.mp4');

      progressPanel.hidden = true;
      resultPanel.hidden = false;

      // 後片付け
      try { await ffmpeg.deleteFile(inName); } catch (e) {}
      try { await ffmpeg.deleteFile(outName); } catch (e) {}
    } catch (err) {
      console.error('[Tomato Tools]', err);
      progressPanel.hidden = true;
      errorBox.textContent = '処理に失敗しました：' + (err && err.message ? err.message : err);
      errorBox.hidden = false;
    } finally {
      busy = false;
      dropzone.classList.remove('is-busy');
      dropzone.removeAttribute('aria-busy');
    }
  }

  // --- 入力イベント ---
  dropzone.addEventListener('click', () => { if (!busy) fileInput.click(); });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) fileInput.click(); }
  });
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) processFile(f);
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); })
  );
  ['dragleave', 'dragend'].forEach((ev) =>
    dropzone.addEventListener(ev, () => dropzone.classList.remove('is-over'))
  );
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) processFile(f);
  });
  // ページ全体へのドロップでブラウザが動画を開くのを防ぐ
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  againBtn.addEventListener('click', () => {
    resetUI();
    dropzone.focus();
  });
})();