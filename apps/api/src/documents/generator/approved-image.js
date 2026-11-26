import {Buffer} from 'node:buffer';
import {PDFName, PDFString} from 'pdf-lib';

// PDF images normally discard the PNG container. The compositor emits opaque RGB8 PNGs.
// Reuse their exact IDAT payload for PDF rendering and retain the original chunk boundaries.
// IHDR and IEND are deterministic from the dimensions, so the approved file can be recovered byte for byte.
export function preserveApprovedImage(doc,photo,r){
  let image=doc.context.lookup(photo.ref);
  const src=r.foto;
  if(r.foto_extension==='png'&&src[24]===8&&src[25]===2&&src[26]===0&&src[27]===0&&src[28]===0){
    const idat=[];
    let pos=33;
    while(pos+12<=src.length&&src.toString('ascii',pos+4,pos+8)==='IDAT'){
      const size=src.readUInt32BE(pos);
      if(pos+size+12>src.length||idat.length>=4096)break;
      idat.push(src.subarray(pos+8,pos+8+size));pos+=12+size;
    }
    if(idat.length&&pos+12===src.length&&src.readUInt32BE(pos)===0&&src.toString('ascii',pos+4,pos+8)==='IEND'){
      image=doc.context.stream(Buffer.concat(idat),{
        Type:'XObject',Subtype:'Image',Width:photo.width,Height:photo.height,ColorSpace:'DeviceRGB',BitsPerComponent:8,
        Filter:'FlateDecode',DecodeParms:{Predictor:15,Colors:3,BitsPerComponent:8,Columns:photo.width},
        CompIPNGChunkSizes:idat.map(part=>part.length)
      });
      doc.context.assign(photo.ref,image);
    }
  }
  image.dict.set(PDFName.of('CompIImageSHA256'),PDFString.of(r.foto_sha256));
  return image;
}

