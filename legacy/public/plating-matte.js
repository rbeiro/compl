// Extend only the image's outermost pixels into the empty strips around object-fit:contain.
// Transparent pixels show the same underlying paper as the image itself.
export function drawPlatingMatte(canvas,image,width,height){
  const iw=image.naturalWidth,ih=image.naturalHeight;
  if(!iw||!ih||!(width>0&&height>0))return;
  const scale=Math.min(1,1024/Math.max(width,height));
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  const w=canvas.width,h=canvas.height,ratio=Math.min(w/iw,h/ih);
  const dx=(w-iw*ratio)/2,dy=(h-ih*ratio)/2;
  // The foreground is always presented at its own aspect ratio over the transparent canvas.
  if(dx>.05){
    ctx.drawImage(image,0,0,1,ih,0,0,dx,h);
    ctx.drawImage(image,iw-1,0,1,ih,w-dx,0,dx,h);
  }else if(dy>.05){
    ctx.drawImage(image,0,0,iw,1,0,0,w,dy);
    ctx.drawImage(image,0,ih-1,iw,1,0,h-dy,w,dy);
  }
}

export function attachPlatingMatte(container,image){
  const canvas=document.createElement('canvas');
  canvas.className='kit-image-matte';canvas.setAttribute('aria-hidden','true');
  container.prepend(canvas);
  let disposed=false;
  function paint(){
    if(disposed||!image.complete||!image.naturalWidth)return;
    try{drawPlatingMatte(canvas,image,container.clientWidth,container.clientHeight);}
    catch{canvas.width=0;} // Keep the image and neutral paper on devices without a canvas context.
  }
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(paint):null;
  observer?.observe(container);
  if(!observer)window.addEventListener('resize',paint);
  image.addEventListener('load',paint);
  paint();
  return ()=>{
    disposed=true;observer?.disconnect();if(!observer)window.removeEventListener('resize',paint);
    image.removeEventListener('load',paint);
  };
}
