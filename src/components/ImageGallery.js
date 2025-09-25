import React, { useState, useEffect, useRef } from 'react';
import Lightbox from 'react-image-lightbox';
import 'react-image-lightbox/style.css';
import Papa from 'papaparse';
import { Gallery } from 'react-grid-gallery';
import '../styles/ImageGallery.css';

const ImageGallery = () => {
  const [allImages, setAllImages] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [imagesPerPage, setImagesPerPage] = useState(20);
  const [fullscreenIndex, setFullscreenIndex] = useState(null);
  const [autoScrollInterval, setAutoScrollInterval] = useState(null);
  const [isWaitingForPageChange, setIsWaitingForPageChange] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  
  const [galleryImages, setGalleryImages] = useState([]);

  useEffect(() => {
    let isMounted = true;
    // Load images from CSV file
    fetch('/temporary/img.txt')
      .then(response => {
        if (!response.ok) throw new Error('Cannot load CSV file: ' + response.statusText);
        return response.text();
      })
      .then(data => {
        if (!data.trim()) {
          showError('Empty CSV file. Please check the file.');
          return;
        }
        Papa.parse(data, {
          header: true,
          skipEmptyLines: true,
          complete: function(results) {
            if (!isMounted) return;
            const validImages = results.data.filter(image => image.Url && image.Filename);
            if (validImages.length === 0) {
              showError('No valid images found in CSV file.');
              return;
            }
            setAllImages(validImages);
            setTotalPages(Math.ceil(validImages.length / imagesPerPage));
            restoreViewState();
          },
          error: function(error) {
            if (!isMounted) return;
            showError('Error parsing CSV: ' + error.message);
          }
        });
      })
      .catch(error => {
        if (!isMounted) return;
        showError('Error loading CSV file: ' + error.message);
      });

    // Touch navigation is now handled in a separate useEffect hook

    return () => {
      isMounted = false;
      // Cleanup auto scroll on unmount
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
      }
    };
  }, []);

  // Update total pages when imagesPerPage changes
  useEffect(() => {
    if (allImages.length > 0) {
      setTotalPages(Math.ceil(allImages.length / imagesPerPage));
    }
  }, [allImages, imagesPerPage]);

  // Save view state when page changes
  useEffect(() => {
    saveViewState();
    updateUrl();
  }, [currentPage]);

  const handleError = (error) => {
    console.error('Error loading images:', error);
    alert(`Error loading images: ${error.message}`);
  };

  const getCurrentImages = () => {
    const start = (currentPage - 1) * imagesPerPage;
    const end = Math.min(start + imagesPerPage, allImages.length);
    return allImages.slice(start, end);
  };
  
  // Transform images for react-grid-gallery
  useEffect(() => {
    const currentImages = getCurrentImages();
    const formattedImages = currentImages.map((image, i) => ({
      src: image.Url,
      thumbnail: image.Url,
      thumbnailWidth: 600,
      thumbnailHeight: 400,
      caption: image.Filename,
      tags: [],
      customOverlay: null,
      originalIndex: i + (currentPage - 1) * imagesPerPage
    }));
    setGalleryImages(formattedImages);
  }, [currentPage, imagesPerPage, allImages]);

  const showFullscreen = (index) => {
    stopAutoScroll();
    setFullscreenIndex(index);
    // Don't change the current page when showing fullscreen
  };

  const hideFullscreen = () => {
    setFullscreenIndex(null);
  };

  const nextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const goToPage = (pageNumber) => {
    const parsedPage = parseInt(pageNumber, 10);
    if (!isNaN(parsedPage) && parsedPage >= 1 && parsedPage <= totalPages) {
      setCurrentPage(parsedPage);
    }
    // Don't change page if input is invalid
  };

  // Touch navigation variables
  const touchRef = useRef({
    touchStartX: 0,
    touchStartY: 0,
    touchEndX: 0,
    touchEndY: 0
  });

  // Handle fullscreen touch and wheel events
  useEffect(() => {
    if (fullscreenIndex !== null) {
      const fullscreenElement = document.getElementById('fullscreen');
      if (!fullscreenElement) return;
      
      const handleTouchStart = (e) => {
        touchRef.current.touchStartX = e.changedTouches[0].screenX;
        touchRef.current.touchStartY = e.changedTouches[0].screenY;
      };

      const handleTouchMove = (e) => {
        e.preventDefault();
      };

      const handleTouchEnd = (e) => {
        touchRef.current.touchEndX = e.changedTouches[0].screenX;
        touchRef.current.touchEndY = e.changedTouches[0].screenY;
        handleFullscreenSwipe();
      };

      const handleFullscreenSwipe = () => {
        const { touchStartX, touchStartY, touchEndX, touchEndY } = touchRef.current;
        const swipeX = touchStartX - touchEndX;
        const swipeY = touchStartY - touchEndY;
        const minSwipeDistance = 50;

        if (Math.abs(swipeY) > Math.abs(swipeX) && Math.abs(swipeY) > minSwipeDistance) {
          hideFullscreen();
        } else if (Math.abs(swipeX) > minSwipeDistance) {
          if (swipeX > 0 && fullscreenIndex < allImages.length - 1) {
            showFullscreen(fullscreenIndex + 1);
          } else if (swipeX < 0 && fullscreenIndex > 0) {
            showFullscreen(fullscreenIndex - 1);
          }
        }
      };

      const handleWheel = (e) => {
        e.preventDefault();
        if (e.deltaY > 0 && fullscreenIndex < allImages.length - 1) {
          showFullscreen(fullscreenIndex + 1);
        } else if (e.deltaY < 0 && fullscreenIndex > 0) {
          showFullscreen(fullscreenIndex - 1);
        }
      };

      fullscreenElement.addEventListener('touchstart', handleTouchStart);
      fullscreenElement.addEventListener('touchmove', handleTouchMove, { passive: false });
      fullscreenElement.addEventListener('touchend', handleTouchEnd);
      fullscreenElement.addEventListener('wheel', handleWheel);

      return () => {
        fullscreenElement.removeEventListener('touchstart', handleTouchStart);
        fullscreenElement.removeEventListener('touchmove', handleTouchMove);
        fullscreenElement.removeEventListener('touchend', handleTouchEnd);
        fullscreenElement.removeEventListener('wheel', handleWheel);
      };
    }
  }, [fullscreenIndex, allImages.length]);

  const waitForImagesToLoad = (imageElements) => {
    return Promise.all(imageElements.map(img => {
      return new Promise(resolve => {
        if (img.complete) {
          resolve();
        } else {
          img.onload = img.onerror = resolve;
        }
      });
    }));
  };

  const toggleAutoScroll = () => {
    if (autoScrollInterval) {
      stopAutoScroll();
    } else {
      startAutoScroll();
    }
  };

  const startAutoScroll = () => {
    const interval = setInterval(async () => {
      if (isWaitingForPageChange) return;

      window.scrollBy({ top: 5, behavior: 'smooth' });
      const isAtBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 10;

      if (isAtBottom && currentPage < totalPages && !isWaitingForPageChange) {
        setIsWaitingForPageChange(true);
        await new Promise(resolve => setTimeout(resolve, 3000));
        setCurrentPage(currentPage + 1);
        // Wait for images to load after page change
        setTimeout(async () => {
          const imageElements = document.querySelectorAll('.image-card');
          await waitForImagesToLoad(Array.from(imageElements));
          setIsWaitingForPageChange(false);
        }, 500);
      } else if (isAtBottom && currentPage === totalPages) {
        stopAutoScroll();
      }
    }, 50);

    setAutoScrollInterval(interval);
  };

  const stopAutoScroll = () => {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      setAutoScrollInterval(null);
      setIsWaitingForPageChange(false);
    }
  };

  const saveViewState = () => {
    localStorage.setItem('galleryState', JSON.stringify({ currentPage, imagesPerPage }));
  };

  const restoreViewState = () => {
    // Only restore view state when the component first loads
    if (currentPage === 1 && allImages.length === 0) {
      const urlParams = new URLSearchParams(window.location.search);
      const pageFromUrl = parseInt(urlParams.get('page'), 10);
      
      if (pageFromUrl && !isNaN(pageFromUrl)) {
        setCurrentPage(Math.min(Math.max(1, pageFromUrl), totalPages));
      } else {
        const savedState = localStorage.getItem('galleryState');
        if (savedState) {
          const state = JSON.parse(savedState);
          setCurrentPage(Math.min(Math.max(1, state.currentPage || 1), totalPages));
          if (state.imagesPerPage) {
            setImagesPerPage(state.imagesPerPage);
          }
        }
      }
    }
  };

  const updateUrl = () => {
    const url = new URL(window.location);
    url.searchParams.set('page', currentPage);
    window.history.pushState({}, '', url);
  };

  // Scroll to top when page changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage]);

  // Get current image for lightbox
  const currentImage = fullscreenIndex !== null ? allImages[fullscreenIndex] : null;
  const nextImageIndex = fullscreenIndex !== null ? (fullscreenIndex + 1) % allImages.length : null;
  const prevImageIndex = fullscreenIndex !== null ? (fullscreenIndex + allImages.length - 1) % allImages.length : null;

  const handlePageInputChange = (e) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value)) {
      goToPage(value);
    }
  };

  const handleImagesPerPageChange = (e) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value > 0) {
      setImagesPerPage(value);
      saveViewState();
    }
  };

  return (
    <div className="container">
      <div className="page-input-container">
        <span className="current-page">Page {currentPage} of {totalPages}</span>
        <div className="page-controls">
          <input 
            type="number" 
            className="page-input" 
            placeholder="Page #" 
            min="1" 
            max={totalPages}
            onChange={handlePageInputChange}
          />
          <button className="go-button" onClick={() => goToPage(document.querySelector('.page-input').value)}>Go</button>
        </div>
        <div className="images-per-page-control">
          <label htmlFor="imagesPerPage">Images per page:</label>
          <select 
            id="imagesPerPage" 
            value={imagesPerPage} 
            onChange={handleImagesPerPageChange}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="30">30</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>
      
      <Gallery 
        images={galleryImages}
        onClick={(index) => showFullscreen(galleryImages[index].originalIndex)}
        enableImageSelection={false}
      />
      
      <div className="pagination">
        <button 
          onClick={prevPage} 
          disabled={currentPage === 1}
        >
          Previous
        </button>
        <span>Page {currentPage} of {totalPages}</span>
        <button 
          onClick={nextPage} 
          disabled={currentPage === totalPages}
        >
          Next
        </button>
      </div>
      
      <div id="fullscreen" className="fullscreen" style={{ display: fullscreenIndex !== null ? 'flex' : 'none' }}>
        {currentImage && (
          <>
            <img src={currentImage.Url} alt={currentImage.Filename} />
            <p>{currentImage.Filename}</p>
            <div className="fullscreen-buttons">
              <button onClick={() => {
                navigator.clipboard.writeText(currentImage.Url);
                alert('Image URL copied!');
              }}>
                Copy URL
              </button>
              <button onClick={() => {
                const searchQuery = currentImage.Filename.replace(/\s+/g, '+');
                window.open(`https://anh.moe/search/images/?q=${searchQuery}`, '_blank');
              }}>
                Search on anh.moe
              </button>
              <button onClick={hideFullscreen}>Close</button>
            </div>
          </>
        )}
      </div>
      
      <div className="auto-scroll-button">
        <button onClick={toggleAutoScroll}>
          {autoScrollInterval ? 'Stop' : 'Auto Scroll'}
        </button>
      </div>
      
      <button className="next-page-button" onClick={nextPage}>
        Next
      </button>

      {fullscreenIndex !== null && currentImage && (
        <Lightbox
          mainSrc={currentImage.Url}
          nextSrc={nextImageIndex !== null ? allImages[nextImageIndex].Url : undefined}
          prevSrc={prevImageIndex !== null ? allImages[prevImageIndex].Url : undefined}
          onCloseRequest={hideFullscreen}
          onMovePrevRequest={() => showFullscreen(prevImageIndex)}
          onMoveNextRequest={() => showFullscreen(nextImageIndex)}
          imageTitle={currentImage.Filename}
        />
      )}
    </div>
  );
};

export default ImageGallery;
