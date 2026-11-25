const folderInput=document.querySelector('#folderInput');
const emptyState=document.querySelector('#emptyState');
const galleryView=document.querySelector('#galleryView');
const galleryGrid=document.querySelector('#galleryGrid');
const folderList=document.querySelector('#folderList');
const sentinel=document.querySelector('#sentinel');
const lightbox=document.querySelector('#lightbox');
const pdfViewer=document.querySelector('#pdfViewer');
const pdfCanvas=document.querySelector('#pdfCanvas');
let pdfjsPromise,pdfDocument=null,pdfPageNumber=1,pdfScale=1,pdfFitMode=true,pdfRenderTask=null;
let images=[],filtered=[],visible=[],selectedFolder='__all',rendered=0,currentIndex=0,viewMode='grid',imageViewIndex=0;
const BATCH=36,urls=new Set();
let deferredInstallPrompt=null;

['#heroUpload','#headerUpload'].forEach(id=>document.querySelector(id).addEventListener('click',()=>folderInput.click()));
folderInput.addEventListener('change',e=>loadFiles([...e.target.files]));
document.querySelector('#themeButton').addEventListener('click',()=>document.documentElement.classList.toggle('dark'));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;document.querySelector('#installButton').classList.add('ready')});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;document.querySelector('#installButton').hidden=true});
document.querySelector('#installButton').addEventListener('click',async()=>{
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return}
  const dialog=document.querySelector('#installDialog'),ios=/iphone|ipad|ipod/i.test(navigator.userAgent),text=document.querySelector('#installInstructions');
  text.innerHTML=ios?'<p>In Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong> and tap <strong>Add</strong>.</p>':'<p>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>';dialog.showModal();
});
document.querySelector('#installClose').addEventListener('click',()=>document.querySelector('#installDialog').close());
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.error));
const appShell=document.querySelector('.app-shell');
const libraryToggle=document.querySelector('#libraryToggle');
libraryToggle.addEventListener('click',()=>{
  const collapsed=appShell.classList.toggle('library-collapsed');
  libraryToggle.setAttribute('aria-expanded',String(!collapsed));
  libraryToggle.setAttribute('aria-label',collapsed?'Open Library panel':'Close Library panel');
  libraryToggle.textContent='☰';
});

function loadFiles(files){
  urls.forEach(URL.revokeObjectURL);urls.clear();
  images=files.filter(f=>f.type.startsWith('image/')||f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf')).map((file,index)=>{
    const path=file.webkitRelativePath||file.name,parts=path.split('/');
    const root=parts.length>1?parts[0]:'Selected images';
    const folder=parts.length>2?parts.slice(1,-1).join(' / '):root;
    const url=URL.createObjectURL(file);urls.add(url);
    return{file,url,index,name:file.name,path,folder,root,size:file.size,type:(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf'))?'pdf':'image'};
  });
  images.sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true,sensitivity:'base'}));
  if(!images.length){alert('That folder does not contain any supported image or PDF files.');return}
  emptyState.hidden=true;galleryView.hidden=false;selectedFolder='__all';setViewMode('grid',false);buildFolders();selectFolder('__all');
}

function buildFolders(){
  const groups=new Map();images.forEach(img=>groups.set(img.folder,(groups.get(img.folder)||0)+1));
  document.querySelector('#folderCount').textContent=groups.size;
  document.querySelector('#allCount').textContent=images.length;
  folderList.replaceChildren(...[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,count])=>{
    const button=document.createElement('button');button.className='nav-item';button.type='button';button.dataset.folder=name;
    button.innerHTML=`<span class="nav-icon">□</span><span title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="nav-count">${count}</span>`;
    return button;
  }));
}

document.querySelector('.sidebar').addEventListener('click',e=>{const button=e.target.closest('[data-folder]');if(button)selectFolder(button.dataset.folder)});
function selectFolder(folder){
  selectedFolder=folder;document.querySelectorAll('[data-folder]').forEach(b=>b.classList.toggle('active',b.dataset.folder===folder));
  const label=folder==='__all'?'All images':folder;
  document.querySelector('#galleryTitle').textContent=label;
  document.querySelector('#galleryEyebrow').textContent=folder==='__all'?(images[0]?.root||'Library'):'Folder';
  document.querySelector('#searchInput').value='';applyFilter();
}

document.querySelector('#searchInput').addEventListener('input',applyFilter);
function applyFilter(){
  const q=document.querySelector('#searchInput').value.trim().toLowerCase();
  filtered=images.filter(img=>(selectedFolder==='__all'||img.folder===selectedFolder)&&(!q||img.name.toLowerCase().includes(q)||img.path.toLowerCase().includes(q)));
  visible=filtered;rendered=0;imageViewIndex=0;galleryGrid.replaceChildren();document.querySelector('#galleryMeta').textContent=`${filtered.length.toLocaleString()} file${filtered.length===1?'':'s'}`;
  document.querySelector('#noResults').hidden=filtered.length!==0;sentinel.hidden=true;
  if(viewMode==='folder')renderFolderView();else if(viewMode==='image')renderImageView();else{sentinel.hidden=filtered.length===0;renderMore()}
}

function renderMore(){
  if(viewMode!=='grid')return;
  if(rendered>=visible.length){sentinel.hidden=true;return}
  const fragment=document.createDocumentFragment();
  visible.slice(rendered,rendered+BATCH).forEach((img,i)=>{
    fragment.append(createTile(img,rendered+i));
  });
  rendered=Math.min(rendered+BATCH,visible.length);galleryGrid.append(fragment);sentinel.hidden=rendered>=visible.length;
}

function createTile(img,index){
  const button=document.createElement('button');button.className='tile';button.type='button';button.dataset.index=index;button.setAttribute('aria-label',`Open ${img.name}`);
  if(img.type==='pdf'){button.classList.add('pdf-tile');const preview=document.createElement('span');preview.className='pdf-preview';preview.innerHTML='<b>PDF</b><span>Document</span>';button.append(preview)}else{const pic=document.createElement('img');pic.src=img.url;pic.alt=img.name;pic.loading='lazy';pic.decoding='async';button.append(pic)}
  const info=document.createElement('span');info.className='tile-info';info.textContent=img.name;button.append(info);return button;
}

function renderFolderView(){
  galleryGrid.className='folder-view';
  const groups=new Map();visible.forEach((img,index)=>{if(!groups.has(img.folder))groups.set(img.folder,[]);groups.get(img.folder).push({img,index})});
  const fragment=document.createDocumentFragment();
  groups.forEach((items,name)=>{
    const section=document.createElement('section');section.className='folder-section';
    const heading=document.createElement('div');heading.className='folder-section-head';heading.innerHTML=`<h2>${escapeHtml(name)}</h2><span>${items.length} image${items.length===1?'':'s'}</span>`;
    const grid=document.createElement('div');grid.className='gallery-grid size-medium';items.forEach(({img,index})=>grid.append(createTile(img,index)));
    section.append(heading,grid);fragment.append(section);
  });galleryGrid.append(fragment);
}

function renderImageView(){
  galleryGrid.className='image-view';if(!visible.length)return;
  imageViewIndex=Math.max(0,Math.min(imageViewIndex,visible.length-1));const img=visible[imageViewIndex];
  const media=img.type==='pdf'?`<span class="pdf-inline-preview"><b>PDF</b><span>${escapeHtml(img.name)}</span><small>Open document</small></span>`:`<img src="${img.url}" alt="${escapeHtml(img.name)}">`;
  galleryGrid.innerHTML=`<div class="image-stage"><button type="button" class="image-step" data-step="-1" aria-label="Previous file">‹</button><button type="button" class="image-focus" data-index="${imageViewIndex}" aria-label="Open ${escapeHtml(img.name)} fullscreen">${media}</button><button type="button" class="image-step" data-step="1" aria-label="Next file">›</button></div><div class="image-details"><strong>${escapeHtml(img.name)}</strong><span>${escapeHtml(img.folder)} · ${imageViewIndex+1} of ${visible.length}</span></div>`;
}

function setViewMode(mode,rerender=true){
  viewMode=mode;galleryView.classList.toggle('mode-image',mode==='image');document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===mode));
  document.querySelector('.segmented').hidden=mode!=='grid';if(rerender)applyFilter();
}
new IntersectionObserver(entries=>{if(entries[0].isIntersecting)renderMore()},{rootMargin:'800px'}).observe(sentinel);
galleryGrid.addEventListener('click',e=>{
  const step=e.target.closest('[data-step]');if(step){imageViewIndex=(imageViewIndex+Number(step.dataset.step)+visible.length)%visible.length;galleryGrid.replaceChildren();renderImageView();return}
  const tile=e.target.closest('[data-index]');if(tile)openLightbox(Number(tile.dataset.index));
});

function openLightbox(index){currentIndex=index;lightbox.showModal();document.body.style.overflow='hidden';updateLightbox()}
async function updateLightbox(){
  const item=visible[currentIndex];if(!item)return;const image=document.querySelector('#lightboxImage');
  if(pdfRenderTask){pdfRenderTask.cancel();pdfRenderTask=null}if(pdfDocument){pdfDocument.destroy();pdfDocument=null}
  if(item.type==='pdf'){image.hidden=true;image.removeAttribute('src');pdfViewer.hidden=false;await loadPdf(item)}else{pdfViewer.hidden=true;image.hidden=false;image.src=item.url;image.alt=item.name}
  document.querySelector('#lightboxName').textContent=item.name;document.querySelector('#lightboxPath').textContent=item.path;document.querySelector('#lightboxCaption').textContent=`${currentIndex+1} of ${visible.length}`;
}

async function getPdfJs(){
  if(!pdfjsPromise)pdfjsPromise=import('./vendor/pdf.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',location.href).href;return lib});
  return pdfjsPromise;
}
async function loadPdf(item){
  const loading=document.querySelector('#pdfLoading');loading.hidden=false;pdfPageNumber=1;pdfFitMode=true;
  try{const lib=await getPdfJs();pdfDocument=await lib.getDocument(item.url).promise;document.querySelector('#pdfPageCount').textContent=`/ ${pdfDocument.numPages}`;await renderPdfPage()}catch(error){loading.textContent='Unable to render this PDF';console.error(error)}
}
async function renderPdfPage(){
  if(!pdfDocument)return;const loading=document.querySelector('#pdfLoading');loading.hidden=false;
  try{
    const page=await pdfDocument.getPage(pdfPageNumber),wrap=document.querySelector('#pdfCanvasWrap'),base=page.getViewport({scale:1});
    if(pdfFitMode)pdfScale=Math.min((wrap.clientWidth-40)/base.width,(wrap.clientHeight-40)/base.height);
    pdfScale=Math.max(.25,Math.min(4,pdfScale));const viewport=page.getViewport({scale:pdfScale}),pixelRatio=Math.min(window.devicePixelRatio||1,2),context=pdfCanvas.getContext('2d');
    pdfCanvas.width=Math.floor(viewport.width*pixelRatio);pdfCanvas.height=Math.floor(viewport.height*pixelRatio);pdfCanvas.style.width=`${viewport.width}px`;pdfCanvas.style.height=`${viewport.height}px`;
    if(pdfRenderTask)pdfRenderTask.cancel();pdfRenderTask=page.render({canvasContext:context,viewport,transform:pixelRatio===1?null:[pixelRatio,0,0,pixelRatio,0,0]});await pdfRenderTask.promise;pdfRenderTask=null;
    document.querySelector('#pdfPage').value=pdfPageNumber;document.querySelector('#pdfZoomLabel').textContent=`${Math.round(pdfScale*100)}%`;loading.hidden=true;
  }catch(error){if(error?.name!=='RenderingCancelledException')console.error(error)}
}
function changePdfPage(step){if(!pdfDocument)return;pdfPageNumber=Math.max(1,Math.min(pdfDocument.numPages,pdfPageNumber+step));renderPdfPage()}
document.querySelector('#pdfPrev').addEventListener('click',()=>changePdfPage(-1));document.querySelector('#pdfNext').addEventListener('click',()=>changePdfPage(1));
document.querySelector('#pdfPage').addEventListener('change',e=>{if(!pdfDocument)return;pdfPageNumber=Math.max(1,Math.min(pdfDocument.numPages,Number(e.target.value)||1));renderPdfPage()});
document.querySelector('#pdfZoomOut').addEventListener('click',()=>{pdfFitMode=false;pdfScale-=.2;renderPdfPage()});document.querySelector('#pdfZoomIn').addEventListener('click',()=>{pdfFitMode=false;pdfScale+=.2;renderPdfPage()});
document.querySelector('#pdfFit').addEventListener('click',()=>{pdfFitMode=true;renderPdfPage()});
document.querySelector('#pdfDownload').addEventListener('click',()=>{const item=visible[currentIndex];if(item?.type!=='pdf')return;const link=document.createElement('a');link.href=item.url;link.download=item.name;link.click()});
window.addEventListener('resize',()=>{if(lightbox.open&&pdfDocument&&pdfFitMode)renderPdfPage()});
function move(direction){currentIndex=(currentIndex+direction+visible.length)%visible.length;updateLightbox()}
document.querySelector('#prevButton').addEventListener('click',()=>move(-1));document.querySelector('#nextButton').addEventListener('click',()=>move(1));
document.querySelector('#closeLightbox').addEventListener('click',()=>lightbox.close());lightbox.addEventListener('close',()=>{document.body.style.overflow='';if(pdfRenderTask)pdfRenderTask.cancel();if(pdfDocument){pdfDocument.destroy();pdfDocument=null}});
document.querySelector('#fullscreenButton').addEventListener('click',()=>{if(!document.fullscreenElement)lightbox.requestFullscreen?.();else document.exitFullscreen?.()});
document.addEventListener('keydown',e=>{if(!lightbox.open)return;if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1)});
document.querySelector('.segmented').addEventListener('click',e=>{const b=e.target.closest('[data-size]');if(!b)return;document.querySelectorAll('[data-size]').forEach(x=>x.classList.toggle('active',x===b));galleryGrid.className=`gallery-grid size-${b.dataset.size}`});
document.querySelector('.view-switch').addEventListener('click',e=>{const button=e.target.closest('[data-view]');if(button)setViewMode(button.dataset.view)});
window.addEventListener('beforeunload',()=>urls.forEach(URL.revokeObjectURL));
function escapeHtml(value){const div=document.createElement('div');div.textContent=value;return div.innerHTML}
