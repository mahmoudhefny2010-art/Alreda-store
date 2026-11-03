const { PassThrough } = require('node:stream');
const sharp = require('sharp');
const { createPaymentProofMedia } = require('../../src/services/payment-proof-media.service');
const { readInstaPayConfig } = require('../../src/config/instapay');
const config={enabled:true,cloudName:'synthetic',apiKey:'123',apiSecret:'synthetic-only',rootFolder:'test-store'};
it('keeps InstaPay disabled without real destination details and accepts configured QR or direct transfer links',()=>{
  expect(readInstaPayConfig({})).toMatchObject({enabled:false,phone:''});
  expect(readInstaPayConfig({INSTAPAY_ENABLED:'true'}).enabled).toBe(false);
  const input={INSTAPAY_ENABLED:'true',INSTAPAY_PHONE:'15550100100',INSTAPAY_URL:'https://example.invalid/synthetic-transfer'};
  expect(readInstaPayConfig(input).enabled).toBe(true);
  expect(readInstaPayConfig({...input,INSTAPAY_URL:'javascript:invalid'}).enabled).toBe(false);
  expect(readInstaPayConfig({...input,INSTAPAY_QR_URL:'/assets/../secret.png'}).enabled).toBe(false);
});
it('decodes actual image bytes and uses authenticated Cloudinary uploads without returning public URLs',async()=>{
  const client={uploader:{upload_stream:vi.fn((options,callback)=>{
    const stream=new PassThrough();stream.resume();stream.on('finish',()=>callback(null,{public_id:options.public_id,resource_type:'image',type:'authenticated',format:'png'}));return stream;
  })}};
  const media=createPaymentProofMedia({config,client});
  const buffer=await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();
  const asset=await media.upload(buffer,'image/png');
  expect(asset.public_id).toMatch(/^test-store\/payment-proofs\/[0-9a-f-]+$/);expect(asset).not.toHaveProperty('secure_url');
  expect(client.uploader.upload_stream.mock.calls[0][0]).toMatchObject({type:'authenticated',overwrite:false});
  await expect(media.upload(Buffer.from('not an image'),'image/png')).rejects.toThrow();
});
it('keeps signed download URLs server-side and rejects assets outside the proof folder',async()=>{
  const client={utils:{private_download_url:vi.fn(()=> 'https://api.cloudinary.com/synthetic-private-download')}};
  const fetchImpl=vi.fn(async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer}));
  const media=createPaymentProofMedia({config,client,fetchImpl});
  expect(await media.read({public_id:'test-store/payment-proofs/synthetic',format:'png'})).toEqual(Buffer.from([1,2]));
  expect(client.utils.private_download_url.mock.calls[0][2]).toMatchObject({type:'authenticated'});
  await expect(media.read({public_id:'unrelated/product',format:'png'})).rejects.toThrow('INVALID_PAYMENT_ASSET');
});
