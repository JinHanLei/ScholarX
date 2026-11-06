import requests
import gzip
import shutil
import os
import hashlib
import sys
from tqdm import tqdm
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

def format_file_size(size_bytes):
    """格式化文件大小（B/KB/MB/GB）"""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.2f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.2f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


def calculate_md5(file_path, chunk_size=1024 * 1024):
    """计算文件的MD5哈希值（分块处理大文件，避免内存溢出）"""
    md5_hash = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in tqdm(
                iter(lambda: f.read(chunk_size), b""),
                desc=f"计算 {os.path.basename(file_path)} MD5",
                unit="B",
                unit_scale=True,
                unit_divisor=1024
        ):
            md5_hash.update(chunk)
    return md5_hash.hexdigest()


def download_md5_file(md5_url, md5_file_path):
    """下载官方MD5校验文件"""
    session = requests.Session()
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504]
    )
    session.mount("https://", HTTPAdapter(max_retries=retry_strategy))

    try:
        response = session.get(md5_url, timeout=15, verify=True)
        response.raise_for_status()
        with open(md5_file_path, "w", encoding="utf-8") as f:
            f.write(response.text.strip())
        print(f"MD5校验文件下载完成：{md5_file_path}")
        return True
    except Exception as e:
        print(f"MD5校验文件下载失败：{e}")
        return False
    finally:
        session.close()


def get_official_md5(md5_file_path):
    """从MD5文件中提取官方哈希值（支持标准MD5文件格式）"""
    if not os.path.exists(md5_file_path):
        return None
    with open(md5_file_path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    # MD5文件格式通常是："哈希值 文件名" 或 "哈希值\t文件名"
    if " " in content:
        return content.split(" ")[0].strip()
    elif "\t" in content:
        return content.split("\t")[0].strip()
    else:
        return content  # 极端情况：仅存储哈希值


def download_dblp_xml():
    """
    下载DBLP数据文件（断点续传+文件大小校验+MD5校验），解压并保存
    """
    # 配置参数
    xml_gz_url = "https://dblp.uni-trier.de/xml/dblp.xml.gz"
    md5_url = "https://dblp.uni-trier.de/xml/dblp.xml.gz.md5"  # 官方MD5校验文件
    dtd_url = "https://dblp.uni-trier.de/xml/dblp.dtd"
    gz_file_path = "dblp.xml.gz"
    md5_file_path = os.path.join("dblp", "dblp.xml.gz.md5.current")
    last_md5_file_path = os.path.join("dblp", "dblp.xml.gz.md5")
    xml_file_path = os.path.join("dblp", "dblp.xml")
    dtd_file_path = os.path.join("dblp", "dblp.dtd")
    chunk_size = 1024 * 1024  # 1MB下载块
    max_retries = 5
    timeout = 30

    # 创建目标文件夹
    os.makedirs(os.path.dirname(xml_file_path), exist_ok=True)

    # 初始化请求会话（重试机制）
    session = requests.Session()
    retry_strategy = Retry(
        total=max_retries,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "HEAD"]
    )
    session.mount("https://", HTTPAdapter(max_retries=retry_strategy))
    session.mount("http://", HTTPAdapter(max_retries=retry_strategy))

    try:
        # -------------------------- 第一步：先拉取官方 MD5，若未变化则跳过大文件下载 --------------------------
        md5_download_success = download_md5_file(md5_url, md5_file_path)
        official_md5 = get_official_md5(md5_file_path) if md5_download_success else None
        previous_md5 = get_official_md5(last_md5_file_path)

        if official_md5 and previous_md5 and official_md5.lower() == previous_md5.lower() and os.path.exists(xml_file_path):
            print(f"✅ DBLP MD5 未变化 ({official_md5})，跳过 XML 下载和解压。")
            if not os.path.exists(dtd_file_path):
                print("\n本地 DTD 不存在，补充下载 DBLP DTD...")
                dtd_response = session.get(dtd_url, timeout=timeout, verify=True)
                dtd_response.raise_for_status()
                with open(dtd_file_path, "wb") as f:
                    f.write(dtd_response.content)
                print(f"✅ DTD下载完成！DTD文件路径：{dtd_file_path}")
            if os.path.exists(md5_file_path):
                os.remove(md5_file_path)
            return 2

        if official_md5 and previous_md5:
            print(f"DBLP MD5 已变化：{previous_md5} -> {official_md5}")
        elif official_md5:
            print(f"当前官方 DBLP MD5：{official_md5}")
        else:
            print("警告：无法获取官方 MD5，将继续下载并在下载后尽量校验。")

        # -------------------------- 第二步：下载压缩包（断点续传）--------------------------
        local_file_size = os.path.getsize(gz_file_path) if os.path.exists(gz_file_path) else 0
        if local_file_size > 0:
            print(f"发现部分下载文件，大小：{format_file_size(local_file_size)}，将从断点继续下载...")

        # 断点续传请求头
        headers = {"Range": f"bytes={local_file_size}-"} if local_file_size > 0 else {}

        response = session.get(
            xml_gz_url,
            stream=True,
            headers=headers,
            timeout=timeout,
            verify=True
        )
        response.raise_for_status()

        # 获取服务器文件总大小
        total_size = None
        if "Content-Range" in response.headers:
            total_size = int(response.headers["Content-Range"].split("/")[-1])
        elif "Content-Length" in response.headers:
            total_size = int(response.headers["Content-Length"]) + local_file_size

        # 下载进度条
        progress_bar = tqdm(
            total=total_size - local_file_size if total_size else None,
            initial=0,
            unit="B",
            unit_scale=True,
            unit_divisor=1024,
            desc=f"下载 {os.path.basename(gz_file_path)}"
        )

        # 分块下载并追加写入
        with open(gz_file_path, "ab") as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
                    progress_bar.update(len(chunk))
        progress_bar.close()

        # 初步校验：文件大小
        final_file_size = os.path.getsize(gz_file_path)
        if total_size and final_file_size != total_size:
            raise Exception(
                f"文件大小不匹配！服务器总大小：{format_file_size(total_size)}，"
                f"本地大小：{format_file_size(final_file_size)}"
            )
        print(f"下载完成！本地文件大小：{format_file_size(final_file_size)}")

        # -------------------------- 第三步：MD5完整性校验 --------------------------
        print("\n开始MD5完整性校验...")
        if not official_md5:
            print("警告：无官方MD5，将跳过MD5校验（仅依赖文件大小校验）")
        else:
            local_md5 = calculate_md5(gz_file_path)
            print(f"官方MD5值：{official_md5}")
            print(f"本地MD5值：{local_md5}")

            if local_md5.lower() != official_md5.lower():
                raise Exception("MD5校验失败！文件损坏或下载不完整")
            print("✅ MD5校验通过，文件完整无损坏！")

        # -------------------------- 第四步：解压文件 --------------------------
        print("\n开始解压...")
        with gzip.open(gz_file_path, "rb") as f_in:
            with open(xml_file_path, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out, length=1024 * 1024 * 10)  # 10MB缓冲区
        print(f"✅ 解压完成！XML文件路径：{xml_file_path}")

        # -------------------------- 第五步：下载 DTD --------------------------
        print("\n开始下载 DBLP DTD...")
        dtd_response = session.get(dtd_url, timeout=timeout, verify=True)
        dtd_response.raise_for_status()
        with open(dtd_file_path, "wb") as f:
            f.write(dtd_response.content)
        print(f"✅ DTD下载完成！DTD文件路径：{dtd_file_path}")

        # 清理临时文件（压缩包+MD5文件）
        os.remove(gz_file_path)
        if official_md5:
            with open(last_md5_file_path, "w", encoding="utf-8") as f:
                f.write(official_md5)
        if os.path.exists(md5_file_path):
            os.remove(md5_file_path)
        print(f"✅ 已清理临时文件：{gz_file_path}")
        print(f"✅ 已保留MD5记录：{last_md5_file_path}")
        return 0

    except requests.exceptions.RequestException as e:
        print(f"\n❌ 网络错误：{e}")
        print("建议检查网络连接，重新运行（支持断点续传）")
        return 1
    except gzip.BadGzipFile as e:
        print(f"\n❌ 解压失败：压缩包损坏（{e}）")
        if os.path.exists(gz_file_path):
            os.remove(gz_file_path)
            print("已删除损坏的压缩包，请重新下载")
        return 1
    except Exception as e:
        print(f"\n❌ 处理失败：{e}")
        # 清理损坏文件
        if os.path.exists(gz_file_path):
            os.remove(gz_file_path)
        if os.path.exists(md5_file_path):
            os.remove(md5_file_path)
        print("已清理异常文件，请重新运行")
        return 1
    finally:
        session.close()


if __name__ == "__main__":
    code = download_dblp_xml()
    sys.exit(code or 0)
