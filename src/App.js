import { useEffect, useState } from "react";
import { Gallery } from "react-grid-gallery";
import Lightbox from "react-image-lightbox";
import "react-image-lightbox/style.css";
import axios from "axios";
import { Buffer } from 'buffer';
import CryptoJS from "crypto-js";
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from "react-router-dom";
import ImageGallery from "./components/ImageGallery";
import VideoGallery from "./components/VideoGallery";

async function getImageDimensions(base64Data) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth / 10, height: img.naturalHeight / 10 });
    img.onerror = reject;
    img.src = base64Data;
  });
}

function MainApp() {
  const [key, setKey] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [index, setIndex] = useState(-1);
  const [images, setImages] = useState([]);
  const [allImages, setAllImages] = useState([]);
  const [tags, setTags] = useState([]);
  const [data, setData] = useState({});
  
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
  
  const selectTag = async (tag) => {
    let tags = selectedTags
    if (tags.includes(tag)) {
      tags = tags.filter(el => el != tag);
      setImages(allImages.filter(el => tags.includes(el.tag)))
    } else {
      tags.push(tag)
      if (allImages.filter(el => el.tag == tag).length == 0) {
        const promises = data[tag].map(async (file) => {
          const fileExtension = file.split('.').pop().toLowerCase();
          const mimeType = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'bmp': 'image/bmp'
          }[fileExtension] || 'image/jpeg'; // Mặc định là jpeg nếu không xác định được

          const imageResponse = await axios.get(`/temporary/images/${tag}/${file}`, {
            responseType: 'arraybuffer'
          });

          let length = key.length;
          const time = Math.ceil(32 / length);
          const encryptionKey = key.repeat(time).substring(0, 32);

          const decrypted = decryptImage(imageResponse.data, encryptionKey);
          const base64Image = `data:${mimeType};base64,${decrypted.toString('base64')}`;
          const dimensions = await getImageDimensions(base64Image);

          return {
            tag: tag,
            src: base64Image,
            original: base64Image,
            width: dimensions.width,
            height: dimensions.height,
          };
        });

        // Chạy tất cả request song song bằng Promise.all
        const images = await Promise.all(promises);

        // Cập nhật state
        setAllImages([...allImages, ...images]);
        setImages([...allImages, ...images].filter(el => tags.includes(el.tag)));
      }
    }
    setSelectedTags(tags)
    if (tags.length == 0) {
      setImages(allImages)
    }
  }
  
  const getLocalImages = async () => {
    try {
      const tag_list = []
      const response = await axios.get('/temporary/images/data.json');
      const folders = response.data;
      for (let folder of folders) {
        tag_list.push(folder.tag)
        data[folder.tag] = folder.files
        setData({ ...data })
      }
      setTags(tag_list);
      setSelectedTags([])
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
        alignItems: "center",
        padding: "10px",
        flexWrap: "wrap"
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
          marginRight: "50px",
          backgroundColor: "red",
          outline: "none",
          border: "none",
          borderRadius: "10px",
          cursor: "pointer"
        }}
          type="submit" onClick={(e) => getLocalImages()}>Reload</button>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {tags.map(t => {
            return <div key={t} style={{
              padding: "5px",
              margin: "2px",
              border: "1px solid red",
              borderRadius: "10px",
              cursor: "pointer",
              backgroundColor: selectedTags.includes(t) ? "red" : "white",
              color: selectedTags.includes(t) ? "white" : "red"
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

export default function App() {
  return (
    <Router basename="/temporary">
      <div className="app-container">
        <nav className="app-nav">
          <ul style={{ display: 'flex', listStyle: 'none', padding: '10px', backgroundColor: '#f0f0f0', margin: 0 }}>
            <li style={{ marginRight: '20px' }}>
              <Link to="/" style={{ textDecoration: 'none', color: '#333', fontWeight: 'bold' }}>Home</Link>
            </li>
            <li style={{ marginRight: '20px' }}>
              <Link to="/img" style={{ textDecoration: 'none', color: '#333', fontWeight: 'bold' }}>Image Gallery</Link>
            </li>
            <li>
              <Link to="/video" style={{ textDecoration: 'none', color: '#333', fontWeight: 'bold' }}>Video Gallery</Link>
            </li>
          </ul>
        </nav>
        
        <Routes>
          <Route path="/" element={<MainApp />} />
          <Route path="/img" element={<ImageGallery />} />
          <Route path="/video" element={<VideoGallery />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}
