// Coordinates in points from the top-left of the approved two-page Arts guide.
// Word and PDF consume the very same ordered primitives and page breaks.
export const paper={width:595.304,height:841.89};
export const logoBox={x:42.5,y:21.3,w:96.4,h:37.45};
const left=42.55,right=552.8;
const accent='345B6F',ink='263338',muted='667177',soft='717A7D',rule='D9DFE1';
const bracket=text=>text?'['+text+']':'';
export const ingredientText=item=>[item.nombre,item.cantidad,item.unidad].filter(Boolean).join(' ');

export function composeGuide(r,ctx,measure,photo) {
  const pages=[];let page;
  const newPage=()=>{page=[];pages.push(page);return page;};
  function line(x,y,x2,width,color){page.push({type:'rule',x,y,w:x2-x,h:width,color});}
  function rect(x,y,w,h,color){page.push({type:'rect',x,y,w,h,color});}
  function text(value,x,y,size,style='regular',color=ink,room=right-x,extra={}) {
    if(value)page.push({type:'text',value,x,y,size,style,color,room,...extra});
  }
  function fit(value,x,y,size,style,color,room,extra={}) {
    const measured=measure(value,size,style);
    const finalSize=Math.min(size,room*size/Math.max(.01,measured));
    text(value,x,y,finalSize,style,color,room,extra);
  }
  function wrap(value,width,size,style='regular') {
    const result=[];
    for(const para of value.split(/\r?\n/)){
      let current='';
      for(const token of para.trim().split(/\s+/).filter(Boolean)){
        if(current&&measure(current+' '+token,size,style)>width){result.push(current);current='';}
        if(measure(token,size,style)<=width){current+=(current?' ':'')+token;continue;}
        for(const char of token){if(current&&measure(current+char,size,style)>width){result.push(current);current='';}current+=char;}
      }
      result.push(current);
    }
    return result;
  }
  // Arabic, CJK and other scripts may need a different typeface; its actual
  // measured metrics are also used to wrap and size the editable Word frames.
  newPage();
  text('02  /  MANUAL OPERATIVO · SALA Y COCINA',left,84.9,8,'bold',accent);
  fit(r.nombre_es.toUpperCase(),left,110.7,22,'boldItalic',soft,right-left,{bookmark:'VistaServicio'});
  if(r.nombre_en && r.nombre_en!==r.nombre_es)fit(r.nombre_en,left,127.8,10.5,'italic',soft,right-left);
  text('01 · Vista y servicio',left,143.2,8,'regular',accent,80,{link:'VistaServicio'});
  text('/',123.05,143.2,8,'regular',muted,8);
  text('02 · Cocina y control',136.35,143.2,8,'regular',accent,100,{link:'CocinaControl'});
  line(left,144.1,111.9,.4,accent);line(136.35,144.1,209.65,.4,accent);
  rect(left,150.5,right-left,20.55,'EDF0F2');
  fit('Código '+bracket(r.codigo)+' · V '+bracket(r.version),47.7,163.6,8.5,'regular',ink,159.5);
  fit('Fecha '+bracket(r.fecha)+' · Partida '+bracket(r.partida),217.8,163.6,8.5,'regular',ink,159.5);
  text('Estado [BORRADOR]',387.9,163.6,8.5,'regular',ink);
  if(photo){
    const scale=Math.min(510.25/photo.width,605.1/photo.height),w=photo.width*scale,h=photo.height*scale;
    page.push({type:'photo',x:left+(510.25-w)/2,y:480.8-h/2,w,h,
      description:'Fotografía de emplatado. '+r.ingredientes.map(ingredientText).join(' · ')});
  } else {
    const value='Fotografía de emplatado pendiente';
    text(value,(paper.width-measure(value,10,'italic'))/2,480.8,10,'italic',muted);
  }
  fit('REFERENCIA APROBADA · Vajilla '+bracket(r.vajilla)+' · Ración '+bracket(r.racion)+' · Tiempo de pase '+bracket(r.pase),42.7,798.5,8,'regular',muted,510);
  newPage();
  function stepsHeading(first){
    text('01  Emplatado paso a paso',left,88.6,12,'bold',accent,right-left,first?{bookmark:'CocinaControl'}:{});
    rect(left,107.1,right-left,19.55,'E7EBEE');
    text('Paso',47.2,119.7,8.5,'bold',accent,27);
    text('Acción / posición en el plato',81.1,119.7,8.5,'bold',accent,344);
    text('Observaciones',435.5,119.7,8.5,'bold',accent,115);
    return 126.95;
  }
  let y=stepsHeading(true);
  for(const [index,step] of r.pasos.entries()){
    const actions=wrap(step.accion,344.3,9),checks=wrap(step.control,112.4,9);
    const count=Math.max(actions.length,checks.length);
    const height=Math.max(34.6,count*10.95+12.7);
    if(y+height>784){newPage();y=stepsHeading(false);}
    function cell(lines,x,w,style,color) {
      const start=y+height/2+2.9-(lines.length-1)*10.95/2;
      lines.forEach((value,i)=>text(value,x,start+i*10.95,9,style,color,w));
    }
    cell([String(index+1).padStart(2,'0')],47.2,26,'bold',accent);
    cell(actions,81.1,344.3,'regular',soft);
    cell(checks,435.5,112.4,'regular',soft);
    y+=height;line(left,y,right,.5,rule);
  }
  const ensure=height=>{if(y+height>784){newPage();y=85;}};
  // Keep entire section labels with the first line of their content.
  y+=38.05;ensure(56);
  text('02  Información para sala',left,y,12,'bold',accent);
  y+=30.35;
  function paragraphs(value,x,width,size,style,color,leading=10.95) {
    for(const row of wrap(value,width,size,style)){ensure(0);text(row,x,y,size,style,color,width);y+=leading;}
  }
  function serviceText(label,value,start) {
    const rows=wrap(label+' '+value,510-(start-left-measure(label+' ',9,'regular')),9);
    const first=rows.shift().slice(label.length).trimStart();
    text(label,left,y,9,'regular',ink,start-left);
    if(first)text(first,start,y,9,'regular',soft,right-start);
    y+=10.95;
    for(const row of rows){ensure(0);text(row,left,y,9,'regular',soft,510);y+=10.95;}
  }
  if(r.sala_es)serviceText('Original',r.sala_es,left+measure('Original ',9,'regular')+2);
  if(r.sala_en && r.sala_en!==r.sala_es){
    y+=20.55;
    serviceText('EN',r.sala_en,60.1);
  }
  y+=13.1;
  const channel=wrap(bracket(r.canal_zona),247,9,'italic'),service=wrap(bracket(r.servicio_exterior),247,9,'italic');
  const cardHeight=29.25+(Math.max(channel.length,service.length)-1)*10.95;
  ensure(cardHeight+50);rect(left,y,right-left,cardHeight,'F3F5F6');
  function infoCell(label,values,x){
    const baseline=y+(cardHeight-29.25-(values.length-1)*10.95)/2+11.65;
    text(label,x,baseline,8,'bold',accent,246);
    values.forEach((value,index)=>text(value,x,baseline+10.7+index*10.95,9,'italic',soft,246));
  }
  infoCell('CANAL Y ZONA',channel,46.9);infoCell('SERVICIO EXTERIOR',service,302);
  y+=cardHeight+17.3;
  const allergyRows=wrap('Contiene '+bracket(r.contiene)+' · Trazas'+(r.trazas?' '+bracket(r.trazas):'')+'.',410,9);
  const adaptRows=wrap('Adaptaciones'+(r.adaptaciones?' '+bracket(r.adaptaciones):'')+'.',410,9);
  ensure(Math.max(72,38+(allergyRows.length+adaptRows.length)*11));
  const qrTop=y-11.55;
  text('ALÉRGENOS Y ADAPTACIONES · VALIDAR EN LA MATRIZ',left,y,8.5,'bold',accent,419);
  y+=13.8;
  for(const row of allergyRows){text(row,left,y,9,'regular',ink,410);y+=10.95;}
  y+=3;
  for(const row of adaptRows){text(row,left,y,9,'regular',ink,410);y+=10.95;}
  y+=2.05;text('Consultar receta y matriz de alérgenos',left,y,8,'regular',accent,410);line(left,y+.9,179.9,.4,accent);
  y+=12.75;text('Enlace digital  · Publicar solo la versión aprobada.',left,y,8,'regular',muted,410);
  // This is the reserved, visibly identified slot supplied by the approved template.
  // No scannable code or link is invented for unpublished recipes.
  page.push({type:'qr',x:470.5,y:qrTop,w:70.85,h:70.85,description:'Espacio reservado para insertar el código QR.'});
  if(!(r.foto&&r.ingredientes_en_foto)){
    y=Math.max(y,qrTop+71)+21;ensure(30);
    text('Ingredientes',left,y,10,'bold',ink);y+=14;
    paragraphs(r.ingredientes.map(ingredientText).join('   •   '),left,510,10,'regular',ink,13);
  }
  return pages;
}

