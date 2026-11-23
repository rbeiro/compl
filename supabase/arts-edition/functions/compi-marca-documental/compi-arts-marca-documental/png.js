import {Buffer} from 'node:buffer';
import {inflateSync} from 'node:zlib';

const maximum = 256 * 1024;
const crcTable = Uint32Array.from({length:256},(_,value)=>{
  for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);
  return value>>>0;
});
function check(ok){if(!ok)throw new Error('invalid_png');}
export function cleanPng(value) {
  check(typeof value==='string' && value.length<=349528 && /^[A-Za-z0-9+/]+={0,2}$/.test(value));
  const bytes=Buffer.from(value,'base64');
  check(bytes.length<=maximum && bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a');
  let at=8, width=0, height=0, channels=0, done=false;
  const parts=[bytes.subarray(0,8)], compressed=[];
  while(at+12<=bytes.length){
    const length=bytes.readUInt32BE(at), end=at+12+length;
    check(end<=bytes.length && !done);
    const kind=bytes.toString('ascii',at+4,at+8), payload=bytes.subarray(at+8,end-4);
    let crc=0xffffffff;
    for(const byte of bytes.subarray(at+4,end-4))crc=crcTable[(crc^byte)&255]^(crc>>>8);
    check(((crc^0xffffffff)>>>0)===bytes.readUInt32BE(end-4));
    if(at===8){
      check(kind==='IHDR' && length===13);
      width=payload.readUInt32BE(0);height=payload.readUInt32BE(4);
      channels=payload[9]===2?3:payload[9]===6?4:0;
      check(width>0 && height>0 && width<=2048 && height<=1024 && width*height<=2100000 &&
            channels>0 && payload[8]===8 && payload.subarray(10).every(v=>v===0));
    }else if(kind==='IDAT') compressed.push(payload);
    else if(kind==='IEND'){check(length===0 && compressed.length>0 && end===bytes.length);done=true;}
    else {
      // Browser colour-space/density metadata is unnecessary after canvas normalization.
      check(['sRGB','gAMA','cHRM','pHYs'].includes(kind));
      at=end;continue;
    }
    parts.push(bytes.subarray(at,end));at=end;
  }
  check(done && at===bytes.length);
  const stride=1+width*channels, inflated=inflateSync(Buffer.concat(compressed),{maxOutputLength:stride*height});
  check(inflated.length===stride*height);
  for(let y=0;y<height;y++)check(inflated[y*stride]<=4);
  return Buffer.concat(parts).toString('base64');
}

