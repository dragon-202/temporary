import { useEffect, useState } from "react";
import { Gallery } from "react-grid-gallery";
import Lightbox from "react-image-lightbox";
import "react-image-lightbox/style.css";
import axios from "axios";
import { Buffer } from 'buffer';
import CryptoJS from "crypto-js";
async function getImageDimensions(base64Data) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth / 10, height: img.naturalHeight / 10 });
    img.onerror = reject;
    img.src = base64Data;
  });
}

export default function App() {
  const [key, setKey] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [index, setIndex] = useState(-1);
  const [images, setImages] = useState([]);
  const [allImages, setAllImages] = useState([]);
  const [tags, setTags] = useState([]);

  function decryptImage(encryptedData, key) {
    const iv = Buffer.from(encryptedData.slice(0, 16)); // IV là 16 byte đầu tiên
    const encrypted = Buffer.from(encryptedData.slice(16)); // Phần còn lại là dữ liệu mã hóa

    const keyWordArray = CryptoJS.lib.WordArray.create(Buffer.from(key));
    const ivWordArray = CryptoJS.lib.WordArray.create(iv);

    // Giải mã
    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: CryptoJS.lib.WordArray.create(encrypted) }, // Dữ liệu mã hóa dạng WordArray
      keyWordArray,
      {
        iv: ivWordArray,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      }
    );

    // Chuyển kết quả giải mã từ WordArray sang Buffer
    const decryptedBuffer = Buffer.from(
      decrypted.toString(CryptoJS.enc.Base64),
      'base64'
    );

    return decryptedBuffer;
  }
  const selectTag = (tag)=> {
    let tags=selectedTags
    if(tags.includes(tag)){
      tags=tags.filter(el=>el!=tag);
    }else{
      tags.push(tag)
    }
    setSelectedTags(tags)
    setImages(allImages.filter(el=>tags.includes(el.tag)))
    if(tags.length==0){
      setImages(allImages)
    }
  }
  const getLocalImages = async () => {
    try {
      const tag_list = []
      const imageData = [];
      const response = await axios.get('/temporary/images/data.json');
      const folders = response.data;
      for (let folder of folders) {
        tag_list.push(folder.tag)
        for (const file of folder.files) {
          const fileExtension = file.split('.').pop().toLowerCase();
          const mimeType = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'bmp': 'image/bmp'
          }[fileExtension] || 'image/jpeg'; // Mặc định là jpeg nếu không xác định được

          const imageResponse = await axios.get(`/temporary/images/${folder.tag}/${file}`, {
            responseType: 'arraybuffer'
          });
          console.log(imageResponse.data)

          let length = key.length;
          const time = Math.ceil(32 / length)
          const encryptionKey = key.repeat(time).substring(0, 32)

          const decrypted = decryptImage(imageResponse.data, encryptionKey)
          console.log(decrypted)
          const base64Image = `data:${mimeType};base64,${decrypted.toString('base64')}`;
          const dimensions = await getImageDimensions(base64Image);
          console.log(dimensions)

          imageData.push({
            tag: folder,
            src: base64Image,
            original: base64Image,
            width: dimensions.width,
            height: dimensions.height,
          })
        }
      }
      setTags(tag_list);
      setAllImages(imageData);
      setImages(imageData)
    } catch (err) {
      console.error('Error loading local images:', err);
      return null;
    }
  };
  useEffect(() => {
  }, []);
  const currentImage = images[index];
  const nextIndex = (index + 1) % images.length;
  const nextImage = images[nextIndex] || currentImage;
  const prevIndex = (index + images.length - 1) % images.length;
  const prevImage = images[prevIndex] || currentImage;

  const handleClick = (index, item) => setIndex(index);
  const handleClose = () => setIndex(-1);
  const handleMovePrev = () => setIndex(prevIndex);
  const handleMoveNext = () => setIndex(nextIndex);


  return (
    <div>
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems:"center",
        padding: "10px"
      }}>
        <input type="text" style={{
          padding: "5px",
          margin: "2px",
          borderRadius: "10px",
        }}
        placeholder="Enter Key" value={key} onChange={e => setKey(e.target.value)}></input>
        <button style={{
          padding: "5px",
          margin: "2px",
          color: "white",
          marginRight:"50px",
          backgroundColor:"red",
          outline:"none",
          border:"none",
          borderRadius: "10px",
          cursor: "pointer"
        }}
          type="submit" onClick={(e) => getLocalImages()}>Reload</button>
        <div style={{display:"flex"}}>
          {tags.map(t => {
            return <div style={{
              padding: "5px",
              margin: "2px",
              border: "1px solid red",
              borderRadius: "10px",
              cursor: "pointer"
            }}
              onClick={(e) => { selectTag(t) }}
            >{t}</div>
          })}
        </div>
      </div>

      <Gallery
        images={images}
        onClick={handleClick}
        enableImageSelection={false}
      />
      {!!currentImage && (
        <Lightbox
          mainSrc={currentImage.original}
          imageTitle={currentImage.caption}
          mainSrcThumbnail={currentImage.src}
          nextSrc={nextImage.original}
          nextSrcThumbnail={nextImage.src}
          prevSrc={prevImage.original}
          prevSrcThumbnail={prevImage.src}
          onCloseRequest={handleClose}
          onMovePrevRequest={handleMovePrev}
          onMoveNextRequest={handleMoveNext}
        />
      )}
    </div>
  );
}
