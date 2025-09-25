import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import '../styles/VideoGallery.css';

const VideoGallery = () => {
  const [allVideos, setAllVideos] = useState([]);
  const [currentPage, setCurrentPage] = useState(() => {
    // Try to get page from URL query params first
    const params = new URLSearchParams(window.location.search);
    const pageParam = params.get('page');
    if (pageParam) {
      const parsed = parseInt(pageParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    
    // Then try localStorage
    const storedPage = localStorage.getItem('videoGalleryPage');
    if (storedPage) {
      const parsed = parseInt(storedPage, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    
    // Default to page 1
    return 1;
  });
  const [pageInput, setPageInput] = useState(currentPage.toString());
  const [videosPerPage] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [previewVideo, setPreviewVideo] = useState(null);
  const [loadingVideos, setLoadingVideos] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [isRegexSearch, setIsRegexSearch] = useState(false);
  const [filteredVideos, setFilteredVideos] = useState([]);
  
  useEffect(() => {
    let isMounted = true;
    
    // Load videos from CSV file
    fetch('/temporary/vid.csv')
      .then(response => {
        if (!response.ok) throw new Error('Cannot load CSV file: ' + response.statusText);
        return response.text();
      })
      .then(data => {
        if (!data.trim()) {
          console.error('Empty CSV file. Please check the file.');
          return;
        }
        Papa.parse(data, {
          header: true,
          skipEmptyLines: true,
          complete: function(results) {
            if (!isMounted) return;
            const validVideos = results.data.filter(video => video.url && video.title);
            if (validVideos.length === 0) {
              console.error('No valid videos found in CSV file.');
              return;
            }
            setAllVideos(validVideos);
            setFilteredVideos(validVideos); // Initialize filtered videos
            setTotalPages(Math.ceil(validVideos.length / videosPerPage));
            restoreViewState();
          },
          error: function(error) {
            if (!isMounted) return;
            console.error('Error parsing CSV: ' + error.message);
          }
        });
      })
      .catch(error => {
        if (!isMounted) return;
        console.error('Error loading CSV file: ' + error.message);
      });
      
    return () => {
      isMounted = false;
    };
  }, [videosPerPage]);
  
  // Filter videos based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredVideos(allVideos);
      return;
    }

    let filtered;
    if (isRegexSearch) {
      try {
        const regex = new RegExp(searchTerm, 'i');
        filtered = allVideos.filter(video => regex.test(video.title));
      } catch (error) {
        console.error('Invalid regex pattern:', error);
        // If regex is invalid, fall back to normal search
        filtered = allVideos.filter(video => 
          video.title.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }
    } else {
      filtered = allVideos.filter(video => 
        video.title.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    setFilteredVideos(filtered);
    // Reset to first page when search changes
    setCurrentPage(1);
  }, [searchTerm, isRegexSearch, allVideos]);
  
  // Get current videos for pagination
  const getCurrentVideos = () => {
    const indexOfLastVideo = currentPage * videosPerPage;
    const indexOfFirstVideo = indexOfLastVideo - videosPerPage;
    return filteredVideos.slice(indexOfFirstVideo, indexOfLastVideo);
  };
  
  // Save view state when page changes
  useEffect(() => {
    saveViewState();
    updateUrl();
  }, [currentPage]);
  
  const saveViewState = () => {
    localStorage.setItem('videoGalleryState', JSON.stringify({ currentPage }));
  };
  
  const restoreViewState = () => {
    // Only restore view state when the component first loads
    if (currentPage === 1 && allVideos.length === 0) {
      const urlParams = new URLSearchParams(window.location.search);
      const pageFromUrl = parseInt(urlParams.get('page'), 10);
      
      if (pageFromUrl && !isNaN(pageFromUrl)) {
        setCurrentPage(Math.min(Math.max(1, pageFromUrl), totalPages));
      } else {
        const savedState = localStorage.getItem('videoGalleryState');
        if (savedState) {
          const state = JSON.parse(savedState);
          setCurrentPage(Math.min(Math.max(1, state.currentPage || 1), totalPages));
        }
      }
    }
  };
  
  const updateUrl = () => {
    const url = new URL(window.location);
    url.searchParams.set('page', currentPage);
    window.history.pushState({}, '', url);
  };
  
  // Pagination controls
  const nextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      setSelectedVideo(null); // Close selected video when changing page
      setPreviewVideo(null); // Reset preview state
    }
  };
  
  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      setSelectedVideo(null); // Close selected video when changing page
      setPreviewVideo(null); // Reset preview state
    }
  };
  
  // This is a duplicate declaration, removing it
  
  const goToPage = (pageNumber) => {
    const parsedPage = parseInt(pageNumber, 10);
    if (!isNaN(parsedPage) && parsedPage >= 1 && parsedPage <= totalPages) {
      setCurrentPage(parsedPage);
      setPageInput('');
      setSelectedVideo(null); // Close selected video when changing page
      setPreviewVideo(null); // Reset preview state
    }
  };
  
  const handlePageInputChange = (e) => {
    setPageInput(e.target.value);
  };
  
  const handlePageInputSubmit = (e) => {
    e.preventDefault();
    goToPage(pageInput);
  };
  
  // Handle video selection
  const handleVideoSelect = (video) => {
    // Stop any active previews
    if (previewVideo) {
      const previewCards = document.querySelectorAll('.video-card');
      previewCards.forEach(card => {
        const videoElement = card.querySelector('.video-thumbnail');
        const thumbnailElement = card.querySelector('.thumbnail-image');
        
        if (videoElement) {
          videoElement.pause();
          try {
            videoElement.currentTime = 1;
          } catch (err) {}
          
          // If there's a thumbnail, restore it
          if (thumbnailElement) {
            thumbnailElement.style.display = 'block';
            videoElement.style.display = 'none';
          }
        }
      });
    }
    
    setSelectedVideo(video);
    setPreviewVideo(null); // Close preview when selecting a video
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  
  // Handle video preview
  const handleVideoPreview = (e, video) => {
    e.stopPropagation(); // Prevent triggering the card click
    
    // Find the video card and elements
    const videoCard = e.target.closest('.video-card');
    if (!videoCard) return;
    
    const videoElement = videoCard.querySelector('.video-thumbnail');
    const thumbnailElement = videoCard.querySelector('.thumbnail-image');
    
    if (previewVideo === video) {
      // If already previewing, stop preview
      setPreviewVideo(null);
      
      // Restore thumbnail if available
      if (video.web_path && videoElement && thumbnailElement) {
        // Pause video
        videoElement.pause();
        try {
          videoElement.currentTime = 1; // Reset to thumbnail frame
        } catch (err) {
          console.log('Error resetting currentTime:', err);
        }
        
        // Show thumbnail, hide video
        thumbnailElement.style.display = 'block';
        videoElement.style.display = 'none';
      }
    } else {
      // If another video is being previewed, restore its thumbnail
      if (previewVideo && previewVideo.web_path) {
        // Find all video cards
        const allVideoCards = document.querySelectorAll('.video-card');
        allVideoCards.forEach(card => {
          // Skip the current card
          if (card === videoCard) return;
          
          const cardVideo = card.querySelector('.video-thumbnail');
          const cardThumbnail = card.querySelector('.thumbnail-image');
          
          if (cardVideo && cardThumbnail) {
            // Pause video
            cardVideo.pause();
            // Show thumbnail, hide video
            cardThumbnail.style.display = 'block';
            cardVideo.style.display = 'none';
          }
        });
      }
      
      // Start preview for this video
      setPreviewVideo(video);
      
      // If we have a thumbnail, we need to show the video element
      if (video.web_path && videoElement && thumbnailElement) {
        // Hide thumbnail, show video
        thumbnailElement.style.display = 'none';
        videoElement.style.display = 'block';
        
        // Start playing the video
        videoElement.currentTime = 0;
        videoElement.playbackRate = 3.0;
        videoElement.play().catch(err => console.log('Preview play error:', err));
      }
    }
  };
  
  // Scroll to top when page changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage]);
  
  return (
    <div className="video-gallery-container">
      {/* Featured Video Player */}
      {selectedVideo && (
        <div className="featured-video-container">
          <video 
            src={selectedVideo.url} 
            controls 
            autoPlay 
            className="featured-video"
            title={selectedVideo.title}
          />
          <h3 className="featured-video-title">{selectedVideo.title}</h3>
        </div>
      )}
      
      {/* Search Controls */}
      <div className="search-controls">
        <div className="search-input-container">
          <input
            type="text"
            className="search-input"
            placeholder={isRegexSearch ? "Search with regex..." : "Search videos..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button 
            className="clear-search-button"
            onClick={() => setSearchTerm('')}
            style={{ display: searchTerm ? 'block' : 'none' }}
          >
            ✕
          </button>
        </div>
        <label className="regex-toggle-label">
          <input
            type="checkbox"
            checked={isRegexSearch}
            onChange={() => setIsRegexSearch(!isRegexSearch)}
          />
          Use Regex
        </label>
        {filteredVideos.length < allVideos.length && (
          <span className="search-results-count">
            Found {filteredVideos.length} of {allVideos.length} videos
          </span>
        )}
      </div>
      
      {/* Pagination Controls */}
      <div className="pagination-controls">
        <span className="current-page">Page {currentPage} of {Math.max(1, Math.ceil(filteredVideos.length / videosPerPage))}</span>
        <div className="page-navigation">
          <button 
            onClick={prevPage} 
            disabled={currentPage === 1}
            className="pagination-button"
          >
            Previous
          </button>
          <form onSubmit={handlePageInputSubmit} className="page-input-form">
            <input 
              type="number" 
              className="page-input" 
              placeholder="Page #" 
              min="1" 
              max={Math.max(1, Math.ceil(filteredVideos.length / videosPerPage))}
              value={pageInput}
              onChange={handlePageInputChange}
            />
            <button 
              type="submit"
              className="go-button"
            >
              Go
            </button>
          </form>
          <button 
            onClick={nextPage} 
            disabled={currentPage === Math.max(1, Math.ceil(filteredVideos.length / videosPerPage))}
            className="pagination-button"
          >
            Next
          </button>
        </div>
      </div>
      
      {/* Video Grid */}
      <div className="video-grid">
        {getCurrentVideos().map((video, index) => (
          <div key={index} className="video-card" onClick={() => handleVideoSelect(video)}>
            <div className={`video-thumbnail-container ${loadingVideos[video.url] ? 'loading' : ''}`}>
              {video.web_path ? (
                <div className="thumbnail-image-container">
                  <img 
                    src={video.web_path} 
                    alt={video.title}
                    className="thumbnail-image"
                    onError={(e) => {
                      // Fallback to video if thumbnail fails to load
                      e.target.style.display = 'none';
                      const videoElement = e.target.closest('.video-thumbnail-container').querySelector('.video-thumbnail');
                      if (videoElement) videoElement.style.display = 'block';
                    }}
                  />
                  <button 
                    className={`play-button ${previewVideo === video ? 'previewing' : ''}`}
                    onClick={(e) => handleVideoPreview(e, video)}
                    onTouchStart={(e) => handleVideoPreview(e, video)}
                  >
                    {previewVideo === video ? '■' : '▶'}
                  </button>
                </div>
              ) : null}
              
              <video 
                src={video.url} 
                className="video-thumbnail" 
                preload="metadata"
                poster={video.web_path ? null : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 100 56'%3E%3Crect width='100' height='56' fill='%23333'/%3E%3Cpath d='M40,28L65,42L65,14Z' fill='%23fff'/%3E%3C/svg%3E"}
                style={{display: video.web_path ? 'none' : 'block'}}
                muted
                playsInline
                ref={(element) => {
                  // Handle preview mode when the previewVideo state changes
                  if (element) {
                    if (previewVideo === video) {
                      // This is the video being previewed
                      element.currentTime = 0;
                      element.playbackRate = 3.0;
                      element.play().catch(err => console.log('Preview play error:', err));
                    } else if (previewVideo !== null) {
                      // Another video is being previewed, make sure this one is paused
                      element.pause();
                      try {
                        element.currentTime = 1; // Reset to thumbnail frame
                      } catch (err) {
                        console.log('Error resetting currentTime:', err);
                      }
                    }
                  }
                }}
                onLoadStart={() => {
                  setLoadingVideos(prev => ({ ...prev, [video.url]: true }));
                }}
                onLoadedData={(e) => {
                  // Set a poster frame from the video itself once loaded
                  try {
                    e.target.currentTime = 1; // Jump to 1 second to get a good thumbnail
                  } catch (err) {
                    console.log('Error setting poster frame:', err);
                  }
                  setLoadingVideos(prev => ({ ...prev, [video.url]: false }));
                }}
                onError={() => {
                  setLoadingVideos(prev => ({ ...prev, [video.url]: false }));
                }}
                onMouseOver={(e) => {
                  // For desktop users, enable preview on hover
                  // Check if it's a desktop device (no touch capability)
                  if (window.matchMedia('(hover: hover)').matches) {
                    // If we have a thumbnail, we need to show the video element on hover
                    if (video.web_path) {
                      const thumbnailElement = e.target.parentNode.querySelector('.thumbnail-image');
                      if (thumbnailElement) {
                        // Hide thumbnail, show video
                        thumbnailElement.style.display = 'none';
                        e.target.style.display = 'block';
                      }
                    }
                    
                    // Start playing and fast-forward
                    e.target.play().catch(err => console.log('Hover play error:', err));
                    // Set playback rate to 3x speed
                    e.target.playbackRate = 3.0;
                    // Fast-forward to a random point in the video (between 10-60% of duration)
                    if (e.target.duration && e.target.duration !== Infinity) {
                      const randomPosition = e.target.duration * (0.1 + Math.random() * 0.5);
                      try {
                        e.target.currentTime = randomPosition;
                      } catch (err) {
                        console.log('Error setting currentTime:', err);
                      }
                    }
                  }
                }}
                onMouseOut={(e) => {
                  // Only restore if not in preview mode
                  if (previewVideo !== video) {
                    // Pause the video
                    e.target.pause();
                    try {
                      e.target.currentTime = 1; // Reset to thumbnail frame
                    } catch (err) {
                      console.log('Error resetting currentTime:', err);
                    }
                    e.target.playbackRate = 1.0;
                    
                    // If we have a thumbnail, restore it
                    if (video.web_path) {
                      const thumbnailElement = e.target.closest('.video-thumbnail-container').querySelector('.thumbnail-image');
                      if (thumbnailElement) {
                        // Show thumbnail, hide video
                        thumbnailElement.style.display = 'block';
                        e.target.style.display = 'none';
                      }
                    }
                  }
                }}
              />
              {!video.web_path && (
                <button 
                  className={`play-button ${previewVideo === video ? 'previewing' : ''}`}
                  onClick={(e) => handleVideoPreview(e, video)}
                  onTouchStart={(e) => handleVideoPreview(e, video)}
                >
                  {previewVideo === video ? '■' : '▶'}
                </button>
              )}
            </div>
            <div className="video-info">
              <h4 className="video-title">{video.title}</h4>
            </div>
          </div>
        ))}
      </div>
      
      {/* Bottom Pagination */}
      <div className="pagination-controls bottom">
        <button 
          onClick={prevPage} 
          disabled={currentPage === 1}
          className="pagination-button"
        >
          Previous
        </button>
        <span className="current-page">Page {currentPage} of {totalPages}</span>
        <form onSubmit={handlePageInputSubmit} className="page-input-form">
          <input 
            type="number" 
            className="page-input" 
            placeholder="Page #" 
            min="1" 
            max={totalPages}
            value={pageInput}
            onChange={handlePageInputChange}
          />
          <button 
            type="submit"
            className="go-button"
          >
            Go
          </button>
        </form>
        <button 
          onClick={nextPage} 
          disabled={currentPage === totalPages}
          className="pagination-button"
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default VideoGallery;
