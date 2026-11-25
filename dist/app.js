const folderInput=document.querySelector('#folderInput');
const emptyState=document.querySelector('#emptyState');
const galleryView=document.querySelector('#galleryView');
const galleryGrid=document.querySelector('#galleryGrid');
const folderList=document.querySelector('#folderList');
const sentinel=document.querySelector('#sentinel');
const lightbox=document.querySelector('#lightbox');
const pdfViewer=document.querySelector('#pdfViewer');
const pdfPages=document.querySelector('#pdfPages');
let pdfjsPromise,pdfDocument=null,pdfPageNumber=1,pdfScale=1,pdfFitMode=true,pdfRenderGeneration=0;
const pdfRenderTasks=new Set();
let mediaNameTimer=null,pdfFullscreenTimer=null;
let images=[],filtered=[],visible=[],selectedFolder='__all',rendered=0,currentIndex=0,viewMode='grid',imageViewIndex=0;
const BATCH=36,urls=new Set();
let deferredInstallPrompt=null;

const HANDLE_DB='luma-library',HANDLE_STORE='folders',HANDLE_KEY='current';
function openHandleDb(){return new Promise((resolve,reject)=>{const request=indexedDB.open(HANDLE_DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(HANDLE_STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function saveFolderHandle(handle){const db=await openHandleDb();await new Promise((resolve,reject)=>{const tx=db.transaction(HANDLE_STORE,'readwrite'),store=tx.objectStore(HANDLE_STORE);store.clear();store.put(handle,HANDLE_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}
async function saveFolderFiles(entries){const db=await openHandleDb();await new Promise((resolve,reject)=>{const tx=db.transaction(HANDLE_STORE,'readwrite'),store=tx.objectStore(HANDLE_STORE);store.clear();store.put(entries.map(entry=>({file:entry.file||entry,path:entry.path||entry.webkitRelativePath||entry.name})),'files');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();navigator.storage?.persist?.().catch(()=>{})}
async function getFolderHandle(){const db=await openHandleDb(),handle=await new Promise((resolve,reject)=>{const request=db.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get(HANDLE_KEY);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});db.close();return handle}
async function getFolderFiles(){const db=await openHandleDb(),files=await new Promise((resolve,reject)=>{const request=db.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get('files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});db.close();return files}
async function forgetFolderHandle(){const db=await openHandleDb();await new Promise((resolve,reject)=>{const tx=db.transaction(HANDLE_STORE,'readwrite');tx.objectStore(HANDLE_STORE).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}
async function readDirectory(handle,path=handle.name){const found=[];for await(const [name,entry] of handle.entries()){const entryPath=`${path}/${name}`;if(entry.kind==='directory')found.push(...await readDirectory(entry,entryPath));else found.push({file:await entry.getFile(),path:entryPath})}return found}
async function openFolder(){
  if(!window.showDirectoryPicker){folderInput.click();return}
  try{const handle=await window.showDirectoryPicker({mode:'read'});await saveFolderHandle(handle);await loadFiles(await readDirectory(handle))}catch(error){if(error?.name!=='AbortError')console.error(error)}
}
['#heroUpload','#headerUpload'].forEach(id=>document.querySelector(id).addEventListener('click',openFolder));
folderInput.addEventListener('change',e=>{const files=[...e.target.files];loadFiles(files);saveFolderFiles(files).catch(error=>console.warn('Folder could not be saved for refresh',error))});
document.querySelector('#refreshButton').addEventListener('click',()=>location.reload());
document.querySelector('#hardRefreshButton').addEventListener('click',async()=>{await forgetFolderHandle().catch(console.error);localStorage.removeItem('lumaFolder');localStorage.removeItem('lumaView');location.reload()});
document.querySelector('#restoreFolder').addEventListener('click',async()=>{const handle=await getFolderHandle().catch(()=>null);if(!handle)return;try{if(await handle.requestPermission({mode:'read'})==='granted'){document.querySelector('#restoreFolder').hidden=true;await loadFiles(await readDirectory(handle),true)}}catch(error){console.error(error)}});
document.querySelector('#themeButton').addEventListener('click',()=>document.documentElement.classList.toggle('dark'));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;document.querySelector('#installButton').classList.add('ready')});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;document.querySelector('#installButton').hidden=true});
document.querySelector('#installButton').addEventListener('click',async()=>{
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return}
  const dialog=document.querySelector('#installDialog'),ios=/iphone|ipad|ipod/i.test(navigator.userAgent),text=document.querySelector('#installInstructions');
  text.innerHTML=ios?'<p>In Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong> and tap <strong>Add</strong>.</p>':'<p>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>';dialog.showModal();
});
document.querySelector('#installClose').addEventListener('click',()=>document.querySelector('#installDialog').close());
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=11',{updateViaCache:'none'}).then(registration=>registration.update()).catch(console.error));
const appShell=document.querySelector('.app-shell');
const libraryToggle=document.querySelector('#libraryToggle');
libraryToggle.addEventListener('click',()=>{
  const collapsed=appShell.classList.toggle('library-collapsed');
  libraryToggle.setAttribute('aria-expanded',String(!collapsed));
  libraryToggle.setAttribute('aria-label',collapsed?'Open Library panel':'Close Library panel');
  libraryToggle.textContent='☰';
});

function loadFiles(files,restore=false){
  urls.forEach(URL.revokeObjectURL);urls.clear();
  images=files.map(entry=>entry?.file?entry:{file:entry,path:entry.webkitRelativePath||entry.name}).filter(entry=>entry.file.type.startsWith('image/')||entry.file.type==='application/pdf'||entry.file.name.toLowerCase().endsWith('.pdf')).map((entry,index)=>{
    const file=entry.file,path=entry.path,parts=path.split('/');
    const root=parts.length>1?parts[0]:'Selected images';
    const folder=parts.length>2?parts.slice(1,-1).join(' / '):root;
    const url=URL.createObjectURL(file);urls.add(url);
    return{file,url,index,name:file.name,path,folder,root,size:file.size,type:(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf'))?'pdf':'image'};
  });
  images.sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true,sensitivity:'base'}));
  if(!images.length){alert('That folder does not contain any supported image or PDF files.');return}
  emptyState.hidden=true;galleryView.hidden=false;buildFolders();
  const rememberedFolder=restore?localStorage.getItem('lumaFolder'):null,rememberedView=restore?localStorage.getItem('lumaView'):null;
  selectedFolder=rememberedFolder==='__all'||images.some(item=>item.folder===rememberedFolder)?rememberedFolder:'__all';setViewMode(['image','folder','grid'].includes(rememberedView)?rememberedView:'grid',false);selectFolder(selectedFolder);
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
  selectedFolder=folder;localStorage.setItem('lumaFolder',folder);document.querySelectorAll('[data-folder]').forEach(b=>b.classList.toggle('active',b.dataset.folder===folder));
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
  viewMode=mode;localStorage.setItem('lumaView',mode);galleryView.classList.toggle('mode-image',mode==='image');document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===mode));
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
  lightbox.classList.toggle('viewing-pdf',item.type==='pdf');
  hideMediaName();
  cancelPdfRenders();if(pdfDocument){pdfDocument.destroy();pdfDocument=null}
  if(item.type==='pdf'){image.hidden=true;image.removeAttribute('src');pdfViewer.hidden=false;await loadPdf(item)}else{pdfViewer.hidden=true;image.hidden=false;image.src=item.url;image.alt=item.name}
  document.querySelector('#lightboxName').textContent=item.name;document.querySelector('#lightboxPath').textContent=item.path;document.querySelector('#lightboxCaption').textContent=`${currentIndex+1} of ${visible.length}`;
}
function showMediaName(){const item=visible[currentIndex],overlay=document.querySelector('#mediaNameOverlay');if(!item)return;clearTimeout(mediaNameTimer);overlay.textContent=item.name;overlay.classList.add('visible');mediaNameTimer=setTimeout(hideMediaName,2800)}
function hideMediaName(){clearTimeout(mediaNameTimer);document.querySelector('#mediaNameOverlay').classList.remove('visible')}
document.querySelector('#lightboxImage').addEventListener('click',showMediaName);
document.querySelector('#pdfCanvasWrap').addEventListener('click',event=>{if(!event.target.closest('button,input,a'))showMediaName()});

async function getPdfJs(){
  if(!pdfjsPromise)pdfjsPromise=Promise.resolve().then(()=>{const lib=window.pdfjsLib;if(!lib)throw new Error('PDF.js failed to load');lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.js',location.href).href;return lib});
  return pdfjsPromise;
}
async function loadPdf(item){
  const loading=document.querySelector('#pdfLoading');loading.textContent='Rendering PDF…';loading.hidden=false;pdfPageNumber=1;pdfFitMode=true;document.querySelector('#pdfDocName').textContent=item.name;
  try{const lib=await getPdfJs(),bytes=new Uint8Array(await item.file.arrayBuffer());pdfDocument=await lib.getDocument({data:bytes}).promise;document.querySelector('#pdfPageCount').textContent=`/ ${pdfDocument.numPages}`;await renderPdfPages()}catch(error){loading.textContent='This PDF could not be rendered. Try selecting the folder again.';console.error(error)}
}
function cancelPdfRenders(){pdfRenderGeneration++;pdfRenderTasks.forEach(task=>task.cancel());pdfRenderTasks.clear()}
async function renderPdfPages(){
  if(!pdfDocument)return;const loading=document.querySelector('#pdfLoading'),wrap=document.querySelector('#pdfCanvasWrap'),generation=++pdfRenderGeneration,currentPage=pdfPageNumber;loading.hidden=false;loading.textContent='Rendering PDF…';pdfRenderTasks.forEach(task=>task.cancel());pdfRenderTasks.clear();pdfPages.replaceChildren();
  try{
    const firstPage=await pdfDocument.getPage(1),firstBase=firstPage.getViewport({scale:1});if(pdfFitMode)pdfScale=(wrap.clientWidth-56)/firstBase.width;pdfScale=Math.max(.25,Math.min(4,pdfScale));const frameWidth=firstBase.width*pdfScale;
    for(let pageNumber=1;pageNumber<=pdfDocument.numPages;pageNumber++){
      if(generation!==pdfRenderGeneration)return;const page=pageNumber===1?firstPage:await pdfDocument.getPage(pageNumber),base=page.getViewport({scale:1}),pageScale=frameWidth/base.width,viewport=page.getViewport({scale:pageScale}),pixelRatio=Math.min(window.devicePixelRatio||1,2),section=document.createElement('section'),canvas=document.createElement('canvas'),context=canvas.getContext('2d');
      section.className='pdf-page';section.dataset.page=pageNumber;section.setAttribute('aria-label',`PDF page ${pageNumber}`);section.style.width=`${viewport.width}px`;section.style.height=`${viewport.height}px`;canvas.width=Math.floor(viewport.width*pixelRatio);canvas.height=Math.floor(viewport.height*pixelRatio);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;section.append(canvas);pdfPages.append(section);
      const task=page.render({canvasContext:context,viewport,transform:pixelRatio===1?null:[pixelRatio,0,0,pixelRatio,0,0]});pdfRenderTasks.add(task);try{await task.promise}catch(error){if(error?.name!=='RenderingCancelledException')throw error}finally{pdfRenderTasks.delete(task)}if(pageNumber===1)loading.hidden=true;
    }
    updatePdfPageUi();if(currentPage>1)scrollToPdfPage(currentPage,false);loading.hidden=true;
  }catch(error){if(error?.name!=='RenderingCancelledException')console.error(error)}
}
function updatePdfPageUi(){document.querySelector('#pdfPage').value=pdfPageNumber;document.querySelector('#pdfZoomLabel').textContent=`${Math.round(pdfScale*100)}%`;document.querySelector('#pdfPrev').disabled=pdfPageNumber===1;document.querySelector('#pdfNext').disabled=pdfPageNumber===pdfDocument?.numPages}
function scrollToPdfPage(pageNumber,smooth=true){const wrap=document.querySelector('#pdfCanvasWrap'),page=pdfPages.querySelector(`[data-page="${pageNumber}"]`);if(!page)return;pdfPageNumber=pageNumber;updatePdfPageUi();wrap.scrollTo({top:page.offsetTop-pdfPages.offsetTop-16,behavior:smooth?'smooth':'auto'})}
function changePdfPage(step){if(!pdfDocument)return;scrollToPdfPage(Math.max(1,Math.min(pdfDocument.numPages,pdfPageNumber+step)))}
document.querySelector('#pdfPrev').addEventListener('click',()=>changePdfPage(-1));document.querySelector('#pdfNext').addEventListener('click',()=>changePdfPage(1));
document.querySelector('#pdfPage').addEventListener('change',e=>{if(!pdfDocument)return;scrollToPdfPage(Math.max(1,Math.min(pdfDocument.numPages,Number(e.target.value)||1)))});
document.querySelector('#pdfZoomOut').addEventListener('click',()=>{pdfFitMode=false;pdfScale-=.2;renderPdfPages()});document.querySelector('#pdfZoomIn').addEventListener('click',()=>{pdfFitMode=false;pdfScale+=.2;renderPdfPages()});
document.querySelector('#pdfFit').addEventListener('click',()=>{pdfFitMode=true;renderPdfPages()});
document.querySelector('#pdfFullscreen').addEventListener('click',async()=>{try{if(pdfViewer.requestFullscreen)await pdfViewer.requestFullscreen({navigationUI:'hide'});else await pdfViewer.webkitRequestFullscreen?.()}catch(error){console.error(error)}});
function hidePdfFullscreenExit(){clearTimeout(pdfFullscreenTimer);document.querySelector('#pdfFullscreenExit').classList.remove('visible')}
document.querySelector('#pdfFullscreenHotspot').addEventListener('click',()=>{const button=document.querySelector('#pdfFullscreenExit');clearTimeout(pdfFullscreenTimer);button.classList.add('visible');pdfFullscreenTimer=setTimeout(hidePdfFullscreenExit,2600)});
document.querySelector('#pdfFullscreenExit').addEventListener('click',event=>{event.stopPropagation();hidePdfFullscreenExit();if(document.fullscreenElement)document.exitFullscreen();else document.webkitExitFullscreen?.()});
function handlePdfFullscreenChange(){hidePdfFullscreenExit();if(pdfDocument&&pdfFitMode)setTimeout(renderPdfPages,50)}
document.addEventListener('fullscreenchange',handlePdfFullscreenChange);document.addEventListener('webkitfullscreenchange',handlePdfFullscreenChange);
document.querySelector('#pdfDownload').addEventListener('click',()=>{const item=visible[currentIndex];if(item?.type!=='pdf')return;const link=document.createElement('a');link.href=item.url;link.download=item.name;link.click()});
let pdfScrollFrame=0;document.querySelector('#pdfCanvasWrap').addEventListener('scroll',event=>{cancelAnimationFrame(pdfScrollFrame);pdfScrollFrame=requestAnimationFrame(()=>{if(!pdfDocument)return;const wrap=event.currentTarget,center=wrap.scrollTop+wrap.clientHeight/2;let closest=pdfPageNumber,distance=Infinity;pdfPages.querySelectorAll('.pdf-page').forEach(page=>{const pageCenter=page.offsetTop-pdfPages.offsetTop+page.offsetHeight/2,gap=Math.abs(pageCenter-center);if(gap<distance){distance=gap;closest=Number(page.dataset.page)}});if(closest!==pdfPageNumber){pdfPageNumber=closest;updatePdfPageUi()}})});
window.addEventListener('resize',()=>{if(lightbox.open&&pdfDocument&&pdfFitMode)renderPdfPages()});
function move(direction){currentIndex=(currentIndex+direction+visible.length)%visible.length;updateLightbox()}
document.querySelector('#prevButton').addEventListener('click',()=>move(-1));document.querySelector('#nextButton').addEventListener('click',()=>move(1));
document.querySelector('#closeLightbox').addEventListener('click',()=>lightbox.close());lightbox.addEventListener('close',()=>{hideMediaName();document.body.style.overflow='';cancelPdfRenders();if(pdfDocument){pdfDocument.destroy();pdfDocument=null}});
document.addEventListener('keydown',e=>{if(!lightbox.open)return;if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1)});
document.querySelector('.segmented').addEventListener('click',e=>{const b=e.target.closest('[data-size]');if(!b)return;document.querySelectorAll('[data-size]').forEach(x=>x.classList.toggle('active',x===b));galleryGrid.className=`gallery-grid size-${b.dataset.size}`});
document.querySelector('.view-switch').addEventListener('click',e=>{const button=e.target.closest('[data-view]');if(button)setViewMode(button.dataset.view)});
window.addEventListener('beforeunload',()=>urls.forEach(URL.revokeObjectURL));
function escapeHtml(value){const div=document.createElement('div');div.textContent=value;return div.innerHTML}

async function restoreSavedFolder(){
  const handle=await getFolderHandle().catch(()=>null);
  if(handle&&window.showDirectoryPicker){try{if(await handle.queryPermission({mode:'read'})==='granted'){await loadFiles(await readDirectory(handle),true);return}document.querySelector('#restoreFolder').hidden=false;return}catch(error){console.error(error)}}
  const savedFiles=await getFolderFiles().catch(()=>null);if(savedFiles?.length)await loadFiles(savedFiles,true);
}
restoreSavedFolder();
