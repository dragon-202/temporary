import cv2
import requests
import numpy as np
from PIL import Image
import os
import sys
import asyncio
import aiohttp
from urllib.parse import urlparse
import time
import pandas as pd
import re
from datetime import datetime

class VideoThumbnailGenerator:
    def __init__(self, output_dir="public/thumbnails", thumbnail_size=(320, 240), concurrent_limit=20, web_path_prefix="/temporary/thumbnails/"):
        """
        Khởi tạo generator thumbnail với asyncio
        
        Args:
            output_dir (str): Thư mục lưu thumbnail
            thumbnail_size (tuple): Kích thước thumbnail (width, height)
            concurrent_limit (int): Số lượng tác vụ song song tối đa
        """
        self.output_dir = output_dir
        self.thumbnail_size = thumbnail_size
        self.concurrent_limit = concurrent_limit
        self.web_path_prefix = web_path_prefix
        self.semaphore = asyncio.Semaphore(concurrent_limit)
        self.create_output_dir()
    
    def create_output_dir(self):
        """Tạo thư mục output nếu chưa tồn tại"""
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)
    
    def clean_filename(self, filename):
        """Làm sạch tên file để phù hợp với hệ điều hành"""
        # Loại bỏ các ký tự không hợp lệ
        cleaned = re.sub(r'[<>:"/\\|?*]', '_', filename)
        # Loại bỏ khoảng trắng thừa
        cleaned = re.sub(r'\s+', '_', cleaned.strip())
        # Giới hạn độ dài
        if len(cleaned) > 100:
            cleaned = cleaned[:100]
        return cleaned
    
    def extract_title_and_timestamp(self, title):
        """
        Trích xuất tên video và timestamp từ title
        Ví dụ: "[BraveDown.Com] [VK Video] [1734636028]" -> ("BraveDown.Com_VK_Video", "1734636028")
        """
        if not title:
            return "unknown", str(int(time.time()))
        
        # Tìm timestamp (số cuối cùng trong ngoặc vuông)
        timestamp_match = re.search(r'\[(\d+)\](?!.*\[\d+\])', title)
        timestamp = timestamp_match.group(1) if timestamp_match else str(int(time.time()))
        
        # Loại bỏ timestamp và làm sạch tên
        clean_title = re.sub(r'\[\d+\](?!.*\[\d+\])', '', title)
        clean_title = re.sub(r'[\[\]]', '', clean_title)
        clean_title = self.clean_filename(clean_title)
        
        if not clean_title:
            clean_title = "video"
        
        return clean_title, timestamp
    
    async def extract_thumbnail_from_stream_async(self, video_url, timestamp=1.0):
        """
        Trích xuất thumbnail từ video stream async mà không tải xuống toàn bộ file
        
        Args:
            video_url (str): Link video
            timestamp (float): Thời điểm lấy frame (giây)
        
        Returns:
            numpy.ndarray: Frame ảnh hoặc None nếu lỗi
        """
        async with self.semaphore:  # Giới hạn concurrent
            try:
                # Chạy CV2 trong thread pool vì nó blocking
                loop = asyncio.get_event_loop()
                frame = await loop.run_in_executor(
                    None, 
                    self._extract_frame_sync, 
                    video_url, 
                    timestamp
                )
                return frame
                
            except Exception as e:
                print(f"Lỗi async khi xử lý video {video_url}: {str(e)}")
                return None
    
    def _extract_frame_sync(self, video_url, timestamp):
        """Hàm đồng bộ để trích xuất frame (được gọi trong thread pool)"""
        try:
            # Mở video từ URL
            cap = cv2.VideoCapture(video_url)
            
            if not cap.isOpened():
                print(f"Không thể mở video: {video_url}")
                return None
            
            # Lấy FPS và tổng số frame
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            
            if fps <= 0:
                fps = 30  # Default FPS
            
            # Tính frame number từ timestamp
            frame_number = min(int(timestamp * fps), total_frames - 1)
            
            # Di chuyển đến frame cần thiết
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            
            # Đọc frame
            ret, frame = cap.read()
            cap.release()
            
            if ret:
                return frame
            else:
                print(f"Không thể đọc frame từ video: {video_url}")
                return None
                
        except Exception as e:
            print(f"Lỗi sync khi xử lý video {video_url}: {str(e)}")
            return None
    
    async def create_thumbnail_async(self, video_url, title=None):
        """
        Tạo thumbnail cho một video (async)
        
        Args:
            video_url (str): Link video
            title (str): Title của video từ CSV
        
        Returns:
            dict: {"success": bool, "thumbnail_path": str, "error": str}
        """
        try:
            # Lấy frame từ video
            frame = await self.extract_thumbnail_from_stream_async(video_url, timestamp=1.0)
            
            if frame is None:
                return {"success": False, "thumbnail_path": None, "error": "Không thể lấy frame"}
            
            # Xử lý ảnh trong thread pool (vì PIL/CV2 blocking)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, 
                self._process_frame_sync, 
                frame, 
                video_url, 
                title
            )
            
            return result
            
        except Exception as e:
            error_msg = f"Lỗi khi tạo thumbnail: {str(e)}"
            print(f"✗ {video_url}: {error_msg}")
            return {"success": False, "thumbnail_path": None, "error": error_msg}
    
    def _process_frame_sync(self, frame, video_url, title):
        """Xử lý frame thành thumbnail (chạy trong thread pool)"""
        try:
            # Lấy kích thước gốc của frame
            h, w = frame.shape[:2]
            target_w, target_h = self.thumbnail_size
            
            # Tính toán tỷ lệ để giữ nguyên aspect ratio
            aspect_ratio = w / h
            target_aspect = target_w / target_h
            
            if aspect_ratio > target_aspect:  # Ảnh rộng hơn
                # Lấy chiều rộng tối đa, tính chiều cao tương ứng
                new_w = target_w
                new_h = int(new_w / aspect_ratio)
            else:  # Ảnh cao hơn hoặc bằng
                # Lấy chiều cao tối đa, tính chiều rộng tương ứng
                new_h = target_h
                new_w = int(new_h * aspect_ratio)
            
            # Resize frame giữ nguyên tỷ lệ
            frame_resized = cv2.resize(frame, (new_w, new_h))
            
            # Tạo ảnh nền đen với kích thước target
            background = np.zeros((target_h, target_w, 3), dtype=np.uint8)
            
            # Tính toán vị trí để căn giữa ảnh
            y_offset = (target_h - new_h) // 2
            x_offset = (target_w - new_w) // 2
            
            # Đặt ảnh đã resize vào giữa background
            background[y_offset:y_offset+new_h, x_offset:x_offset+new_w] = frame_resized
            
            # Chuyển từ BGR sang RGB
            frame_rgb = cv2.cvtColor(background, cv2.COLOR_BGR2RGB)
            
            # Tạo tên file từ title và timestamp
            if title:
                clean_title, timestamp = self.extract_title_and_timestamp(title)
                filename = f"{clean_title}_{timestamp}.jpg"
            else:
                filename = f"video_{int(time.time())}_{hash(video_url) % 10000}.jpg"
            
            filepath = os.path.join(self.output_dir, filename)
            
            # Đảm bảo tên file unique nếu đã tồn tại
            counter = 1
            original_filepath = filepath
            while os.path.exists(filepath):
                name, ext = os.path.splitext(original_filepath)
                filepath = f"{name}_{counter}{ext}"
                counter += 1
            
            # Lưu thumbnail
            pil_image = Image.fromarray(frame_rgb)
            pil_image.save(filepath, 'JPEG', quality=85)
            
            # Tạo web path cho thumbnail
            web_path = self.web_path_prefix + os.path.basename(filepath)
            
            print(f"✓ Đã tạo thumbnail: {os.path.basename(filepath)}")
            return {"success": True, "thumbnail_path": filepath, "web_path": web_path, "error": None}
            
        except Exception as e:
            error_msg = f"Lỗi khi xử lý frame: {str(e)}"
            return {"success": False, "thumbnail_path": None, "error": error_msg}
    
    async def process_csv_batch_async(self, csv_file_path):
        """
        Đọc CSV và tạo thumbnail cho tất cả video (async với concurrent 20)
        
        Args:
            csv_file_path (str): Đường dẫn file CSV input
        
        Returns:
            pandas.DataFrame: DataFrame với kết quả
        """
        try:
            # Đọc CSV
            print(f"Đọc file CSV: {csv_file_path}")
            df = pd.read_csv(csv_file_path)
            
            if 'url' not in df.columns:
                raise ValueError("CSV phải có cột 'url'")
            
            # Đảm bảo có cột title
            if 'title' not in df.columns:
                df['title'] = ''
            
            print(f"Tìm thấy {len(df)} video trong CSV")
            print(f"Sử dụng concurrent limit: {self.concurrent_limit}")
            
            print(f"Bắt đầu tạo thumbnail...")
            start_time = time.time()
            
            # Tạo list các coroutines
            tasks = []
            for idx, row in df.iterrows():
                task = self.create_thumbnail_async(row['url'], row['title'])
                tasks.append((idx, task))
            
            # Chạy tất cả tasks với asyncio.gather
            print(f"🚀 Bắt đầu xử lý {len(tasks)} video với {self.concurrent_limit} concurrent...")
            
            # Chạy concurrent với progress tracking
            results = []
            completed = 0
            success_count = 0
            failed_count = 0
            
            print(f"\n📊 Tổng số video cần xử lý: {len(tasks)}")
            
            # Chia nhỏ thành batches để theo dõi tiến trình
            batch_size = self.concurrent_limit
            for i in range(0, len(tasks), batch_size):
                batch = tasks[i:i + batch_size]
                batch_tasks = [task for idx, task in batch]
                
                # Chạy batch hiện tại
                batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
                
                # Xử lý kết quả batch
                for j, (idx, _) in enumerate(batch):
                    result = batch_results[j]
                    completed += 1
                    
                    if isinstance(result, Exception):
                        result = {"success": False, "thumbnail_path": None, "error": str(result)}
                    
                    # Tạo row data
                    row_data = df.iloc[idx].to_dict()
                    
                    if result['success']:
                        row_data['thumbnail_path'] = result['thumbnail_path']
                        row_data['thumbnail_name'] = os.path.basename(result['thumbnail_path'])
                        row_data['web_path'] = result['web_path']
                        row_data['status'] = 'success'
                        row_data['error'] = ''
                        success_count += 1
                    else:
                        row_data['thumbnail_path'] = ''
                        row_data['thumbnail_name'] = ''
                        row_data['web_path'] = ''
                        row_data['status'] = 'failed'
                        row_data['error'] = result['error']
                        failed_count += 1
                    
                    results.append(row_data)
                
                # Progress update
                progress = (completed / len(tasks)) * 100
                elapsed = time.time() - start_time
                rate = completed / elapsed if elapsed > 0 else 0
                eta = (len(tasks) - completed) / rate if rate > 0 else 0
                
                print(f"📈 Tiến trình: {completed}/{len(tasks)} ({progress:.1f}%) - " 
                      f"Thành công: {success_count} - Thất bại: {failed_count} - "
                      f"Tốc độ: {rate:.1f} video/s - ETA: {eta:.0f}s")
                
                # Lưu kết quả tạm thời sau mỗi batch
                if completed % (batch_size * 2) == 0 or completed == len(tasks):
                    temp_df = pd.DataFrame(results)
                    self.save_results_to_csv(temp_df, "vid.csv")
                    print(f"💾 Đã lưu {completed}/{len(tasks)} kết quả vào vid.csv (Thành công: {success_count}, Thất bại: {failed_count})")
            
            end_time = time.time()
            
            # Tạo DataFrame kết quả
            result_df = pd.DataFrame(results)
            
            # Thống kê
            success_count = len(result_df[result_df['status'] == 'success'])
            failed_count = len(result_df[result_df['status'] == 'failed'])
            
            print(f"\n=== KẾT QUẢ XỬ LÝ ===")
            print(f"📊 Tổng số video đã xử lý: {len(df)} video")
            print(f"✅ Thành công: {success_count}/{len(df)} video ({success_count/len(df)*100:.1f}%)")
            print(f"❌ Thất bại: {failed_count}/{len(df)} video ({failed_count/len(df)*100:.1f}%)")
            print(f"⏱️  Thời gian xử lý: {end_time - start_time:.2f} giây")
            print(f"🚀 Tốc độ trung bình: {len(df)/(end_time - start_time):.2f} video/giây")
            print(f"🔄 Concurrent limit: {self.concurrent_limit}")
            
            return result_df
            
        except Exception as e:
            print(f"Lỗi khi xử lý CSV async: {str(e)}")
            return None
    
    def save_results_to_csv(self, result_df, output_csv_path="vid.csv"):
        """
        Lưu kết quả vào CSV
        
        Args:
            result_df (pandas.DataFrame): DataFrame kết quả
            output_csv_path (str): Đường dẫn file CSV output
        """
        try:
            # Sắp xếp cột
            columns_order = ['url', 'title', 'thumbnail_name', 'web_path', 'thumbnail_path', 'status', 'error']
            existing_columns = [col for col in columns_order if col in result_df.columns]
            other_columns = [col for col in result_df.columns if col not in columns_order]
            final_columns = existing_columns + other_columns
            
            result_df_ordered = result_df[final_columns]
            
            # Lưu file
            result_df_ordered.to_csv(output_csv_path, index=False, encoding='utf-8')
            print(f"✓ Đã lưu kết quả vào: {output_csv_path}")
            
            # Thống kê
            success_count = len(result_df_ordered[result_df_ordered['status'] == 'success'])
            failed_count = len(result_df_ordered) - success_count
            print(f"✓ Tổng cộng: {len(result_df_ordered)} video")
            print(f"✓ Thành công: {success_count}/{len(result_df_ordered)} video ({success_count/len(result_df_ordered)*100:.1f}%)")
            print(f"✓ Thất bại: {failed_count}/{len(result_df_ordered)} video ({failed_count/len(result_df_ordered)*100:.1f}%)")
            
        except Exception as e:
            print(f"Lỗi khi lưu CSV: {str(e)}")

async def process_vid_txt():
    """Xử lý file vid.txt và lưu kết quả vào vid.csv"""
    try:
        # Đọc file vid.txt
        input_file = "public/vid.txt"
        output_csv = "vid.csv"
        
        # Kiểm tra file input có tồn tại không
        if not os.path.exists(input_file):
            print(f"❌ Không tìm thấy file {input_file}")
            # Thử tìm ở thư mục gốc
            alt_input_file = "vid.txt"
            if os.path.exists(alt_input_file):
                print(f"✅ Đã tìm thấy file {alt_input_file}")
                input_file = alt_input_file
            else:
                print("❌ Không tìm thấy file vid.txt trong thư mục gốc")
                return
        
        print(f"Đọc file: {input_file}")
        
        # Đọc CSV trực tiếp bằng pandas với nhiều cách khác nhau
        try:
            # Cách 1: Đọc bằng pandas với các tham số chuẩn
            df = pd.read_csv(input_file)
            print(f"✅ Đã đọc thành công file CSV với {len(df)} dòng")
        except Exception as e1:
            print(f"❌ Lỗi khi đọc file CSV (cách 1): {str(e1)}")
            
            try:
                # Cách 2: Đọc bằng pandas với các tham số nâng cao
                df = pd.read_csv(input_file, encoding='utf-8', escapechar='\\', quotechar='"', on_bad_lines='skip')
                print(f"✅ Đã đọc thành công file CSV (cách 2) với {len(df)} dòng")
            except Exception as e2:
                print(f"❌ Lỗi khi đọc file CSV (cách 2): {str(e2)}")
                
                try:
                    # Cách 3: Đọc thủ công bằng csv module
                    import csv
                    rows = []
                    with open(input_file, 'r', encoding='utf-8') as f:
                        reader = csv.reader(f)
                        header = next(reader)  # Đọc header
                        for row in reader:
                            if len(row) >= 2:  # Đảm bảo có ít nhất 2 cột
                                rows.append({"url": row[0], "title": row[1] if len(row) > 1 else ""})
                    
                    df = pd.DataFrame(rows)
                    print(f"✅ Đã đọc thành công file CSV (cách 3) với {len(df)} dòng")
                except Exception as e3:
                    print(f"❌ Lỗi khi đọc file CSV (cách 3): {str(e3)}")
                    return
        
        # Kiểm tra cột url
        if 'url' not in df.columns:
            print("❌ File vid.txt không có cột url")
            return
        
        # Đảm bảo có cột title
        if 'title' not in df.columns:
            df['title'] = ''
        
        # Khởi tạo generator
        try:
            output_dir = "public/thumbnails"
            if not os.path.exists(output_dir):
                try:
                    os.makedirs(output_dir)
                    print(f"✅ Đã tạo thư mục {output_dir}")
                except Exception as e:
                    output_dir = "thumbnails"
                    if not os.path.exists(output_dir):
                        os.makedirs(output_dir)
                        print(f"✅ Đã tạo thư mục {output_dir}")
            
            generator = VideoThumbnailGenerator(
                output_dir=output_dir,
                thumbnail_size=(320, 180),  # 16:9 aspect ratio
                concurrent_limit=10,  # Giảm xuống để tránh quá tải
                web_path_prefix="/temporary/thumbnails/"
            )
        except Exception as e:
            print(f"❌ Lỗi khi khởi tạo generator: {str(e)}")
            return
        
        # Xử lý CSV
        result_df = await generator.process_csv_batch_async(csv_file_path=input_file)
        
        if result_df is not None:
            # Lưu kết quả vào CSV mới
            generator.save_results_to_csv(result_df, output_csv)
            
            # Tính tổng số thành công và thất bại
            success_count = len(result_df[result_df['status'] == 'success'])
            failed_count = len(result_df[result_df['status'] == 'failed'])
            
            print(f"\n✅ Hoàn thành! Kiểm tra:")
            print(f"  - Thumbnail: thư mục 'public/thumbnails' ({success_count} files)")
            print(f"  - Kết quả CSV: {output_csv} (Tổng {len(result_df)} dòng)")
            print(f"  - Tổng số video đã xử lý: {len(result_df)} (Thành công: {success_count}, Thất bại: {failed_count})")
        else:
            print("❌ Có lỗi xảy ra trong quá trình xử lý")
    
    except Exception as e:
        print(f"❌ Lỗi: {str(e)}")

if __name__ == "__main__":
    # Lấy thời gian bắt đầu để tính tổng thời gian chạy
    start_time = datetime.now()
    print(f"=== BẮT ĐẦU CHẠY SCRIPT THUMBNAIL ({start_time.strftime('%Y-%m-%d %H:%M:%S')}) ===")
    # Kiểm tra và tạo thư mục thumbnails nếu chưa tồn tại
    thumbnail_dir = "public/thumbnails"
    try:
        if not os.path.exists(thumbnail_dir):
            os.makedirs(thumbnail_dir)
            print(f"✅ Đã tạo thư mục {thumbnail_dir}")
        else:
            print(f"✅ Thư mục {thumbnail_dir} đã tồn tại")
    except Exception as e:
        print(f"❌ Không thể tạo thư mục {thumbnail_dir}: {str(e)}")
        # Thử tạo trong thư mục gốc
        thumbnail_dir = "thumbnails"
        try:
            if not os.path.exists(thumbnail_dir):
                os.makedirs(thumbnail_dir)
                print(f"✅ Đã tạo thư mục {thumbnail_dir}")
            else:
                print(f"✅ Thư mục {thumbnail_dir} đã tồn tại")
        except Exception as e2:
            print(f"❌ Không thể tạo thư mục {thumbnail_dir}: {str(e2)}")
            print("❌ Không thể tạo thư mục lưu thumbnail. Thoát chương trình.")
            sys.exit(1)
    
    # Chạy hàm xử lý vid.txt
    try:
        print("🔥 Bắt đầu xử lý video thumbnails...")
        print("\n📊 Thông tin quá trình xử lý sẽ được hiển thị trong quá trình chạy...\n")
        asyncio.run(process_vid_txt())
    except AttributeError:
        # Python < 3.7
        loop = asyncio.get_event_loop()
        loop.run_until_complete(process_vid_txt())
    except Exception as e:
        print(f"❌ Lỗi khi chạy script: {str(e)}")
    finally:
        # In thời gian kết thúc và tổng thời gian chạy
        end_time = datetime.now()
        duration = end_time - start_time
        print(f"\n=== KẾT THÚC SCRIPT THUMBNAIL ({end_time.strftime('%Y-%m-%d %H:%M:%S')}) ===")
        print(f"Tổng thời gian chạy: {duration.total_seconds():.2f} giây")