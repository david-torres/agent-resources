(function () {
  const container = document.getElementById('pdfViewer');
  if (!container || !window.pdfjsLib) {
    return;
  }

  const pdfUrl = container.getAttribute('data-pdf-url');
  if (!pdfUrl) {
    container.innerHTML = '<p class="notification is-danger">Unable to load PDF.</p>';
    return;
  }

  const canvas = document.getElementById('pdfCanvas');
  const currentPageEl = document.getElementById('pdfCurrentPage');
  const totalPagesEl = document.getElementById('pdfTotalPages');
  const buttons = container.querySelectorAll('button[data-action]');

  const context = canvas.getContext('2d');
  const devicePixelRatio = window.devicePixelRatio || 1;

  const MIN_SCALE = 0.8;
  const MAX_SCALE = 2.5;
  const SCALE_STEP = 0.2;

  let pdfDoc = null;
  let currentPage = 1;
  let scale = 1.1;
  let pendingPage = null;
  let renderTask = null;

  const setWorker = () => {
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js';
    }
  };

  const queueRenderPage = (num) => {
    if (renderTask) {
      pendingPage = num;
    } else {
      renderPage(num);
    }
  };

  const renderPage = (num) => {
    renderTask = true;
    pdfDoc.getPage(num).then((page) => {
      const viewport = page.getViewport({ scale });
      const outputScale = devicePixelRatio;

      canvas.height = viewport.height * outputScale;
      canvas.width = viewport.width * outputScale;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const renderContext = {
        canvasContext: context,
        viewport,
        transform: [outputScale, 0, 0, outputScale, 0, 0]
      };

      return page.render(renderContext).promise;
    }).then(() => {
      renderTask = null;
      currentPage = num;
      currentPageEl.textContent = String(num);
      if (pendingPage !== null) {
        const next = pendingPage;
        pendingPage = null;
        queueRenderPage(next);
      }
    }).catch((error) => {
      console.error('Failed to render PDF page', error);
      container.insertAdjacentHTML(
        'beforeend',
        '<p class="notification is-danger mt-4">Failed to render PDF.</p>'
      );
      renderTask = null;
    });
  };

  const changePage = (delta) => {
    const target = currentPage + delta;
    if (!pdfDoc || target < 1 || target > pdfDoc.numPages) {
      return;
    }
    queueRenderPage(target);
  };

  const changeZoom = (delta) => {
    const nextScale = Math.min(Math.max(scale + delta, MIN_SCALE), MAX_SCALE);
    if (nextScale === scale) return;
    scale = nextScale;
    queueRenderPage(currentPage);
  };

  const handleAction = (action) => {
    switch (action) {
      case 'prev':
        changePage(-1);
        break;
      case 'next':
        changePage(1);
        break;
      case 'zoom-in':
        changeZoom(SCALE_STEP);
        break;
      case 'zoom-out':
        changeZoom(-SCALE_STEP);
        break;
      default:
        break;
    }
  };

  buttons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const action = button.getAttribute('data-action');
      handleAction(action);
    });
  });

  container.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  window.addEventListener('resize', () => {
    if (!pdfDoc) return;
    queueRenderPage(currentPage);
  });

  setWorker();

  pdfjsLib.getDocument({
    url: pdfUrl,
    withCredentials: false
  }).promise.then((doc) => {
    pdfDoc = doc;
    totalPagesEl.textContent = String(doc.numPages);
    renderPage(currentPage);
  }).catch((error) => {
    console.error('Failed to load PDF', error);
    container.innerHTML = '<p class="notification is-danger">Failed to load PDF.</p>';
  });
})();

