import pdf2bib
import pdf2doi
from pdf2bib import bibtex_makers
from pdf2doi.main import __find_doi
from io import BytesIO
import json
import requests
from bs4 import BeautifulSoup
from typing import Dict, List, Optional


class NamedBytesIO(BytesIO):
    def __init__(self, content, name=""):
        super().__init__(content)
        self.name = name

pdf2bib.config.set('verbose',False)


def generate_safe_filename(title: str) -> str:
    """根据论文标题生成安全的文件名"""
    # 使用标题生成文件名
    if title and len(title) > 0:
        # 移除无效字符
        invalid_chars = '<>:"/\\|?*'
        safe_title = title[:100]  # 限制长度
        for char in invalid_chars:
            safe_title = safe_title.replace(char, '_')
        
        # 替换空格为下划线
        safe_title = safe_title.replace(' ', '_')
        
        # 确保以.pdf结尾
        if not safe_title.endswith('.pdf'):
            safe_title += '.pdf'
            
        return safe_title
    else:
        # 如果没有标题，使用默认名称
        import time
        return f"paper_{int(time.time())}.pdf"

def extract_cnki_title_from_dxdoiorg(doi):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "zh-CN,en-US;q=0.7,en;q=0.3",
        "Content-Type": "text/html;charset=UTF-8",
        "Referer": "https://dx.doi.org/",
        "Host": "www.chndoi.org"
    }
    url = f"https://www.chndoi.org/Resolution/Handler?doi={doi}"
    soup = BeautifulSoup(requests.get(url, headers=headers).text, 'html.parser')
    info = soup.select_one("table")

    if info:
        for row in info.select("tr"):
            for col in row.select("td"):
                # 获取文本内容并去除<label>标签
                text = ""
                for content in col.contents:
                    if hasattr(content, 'name') and content.name == 'label':
                        continue  # 跳过<label>标签本身
                    elif hasattr(content, 'get_text'):
                        text += content.get_text().strip()
                    else:
                        text += str(content).strip()

                # 如果文本不为空，则处理
                if text.strip():
                    label = col.find('label')
                    if label:
                        label_text = label.get_text().strip().rstrip('：')
                        if label_text == "题名":
                            title = text.strip()
                            return title


class ChineseMetadataExtractor:
    def __init__(self):
        # 配置CNKI请求参数（完善 headers 和资源分类代码）
        self.is_mainland = True  # 是否为中国大陆地区访问
        self.kuaku_code = "YSTT4HG0,LSTPFY1C,JUP3MUPD,MPMFIG1A,WQ0UVIAA,BLZOG7CK,PWFIRAGL,EMRPGLPA,NLBO1Z6R,NN3FJMUV"
        self.product_str = "YSTT4HG0,LSTPFY1C,RMJLXHZ3,JQIRZIYA,JUP3MUPD,1UR4K4HZ,BPBAFJ5S,R79MZMCB,MPMFIG1A,WQ0UVIAA,NB3BWEHK,XVLO76FD,HR1YT1Z9,BLZOG7CK,PWFIRAGL,EMRPGLPA,J708GVCE,ML4DRIDX,NLBO1Z6R,NN3FJMUV,"
        self.cnki_headers = self._get_headers()

    def _get_headers(self) -> Dict[str, str]:
        """构建完整请求头（区分中国大陆/海外）"""
        if self.is_mainland:
            return {
                "Host": "kns.cnki.net",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "zh-CN,en-US;q=0.7,en;q=0.3",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Origin": "https://kns.cnki.net",
                "Referer": f"https://kns.cnki.net/kns8s/AdvSearch?crossids={requests.utils.quote(self.kuaku_code)}",
                "Connection": "keep-alive",
            }
        else:
            return {
                "Host": "chn.oversea.cnki.net",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "zh-CN,en-US;q=0.7,en;q=0.3",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Origin": "https://chn.oversea.cnki.net",
                "Referer": "https://chn.oversea.cnki.net/kns/AdvSearch?dbcode=CFLS&crossDbcodes=CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFN",
                "Connection": "keep-alive",
            }

    def _build_search_exp(self, title: str) -> str:
        """构建符合CNKI规范的搜索表达式（处理标题空格）"""
        if " " in title:
            # 过滤短于4个字符的标题片段，避免无效搜索
            title_parts = [part for part in title.split(" ") if len(part) > 4]
            if title_parts:
                # 组合标题(TI)和主题(SU)条件，提高匹配率
                ti_part = "TI %= " + " % ".join([f"'{part}'" for part in title_parts])
                su_part = "SU %= " + "+".join(title_parts)
                return f"({ti_part} OR {su_part})"
            else:
                return f"TI %= '{title}'"
        else:
            return f"TI %= '{title}'"

    def search_cnki(self, title: str) -> List[Dict]:
        """搜索CNKI获取元数据候选结果（完善参数与逻辑）"""
        try:
            search_exp = self._build_search_exp(title)
            search_exp_aside = search_exp.replace("'", "&#39;")  # 处理HTML转义

            if self.is_mainland:
                url = "https://kns.cnki.net/kns8s/brief/grid"
                # 构建完整QueryJson（含资源分类和检索结构）
                query_json = {
                    "boolSearch": "true",
                    "QueryJson": {
                        "Platform": "",
                        "Resource": "CROSSDB",
                        "Classid": "WD0FTY92",
                        "Products": "",
                        "QNode": {
                            "QGroup": [
                                {
                                    "Key": "Subject",
                                    "Title": "",
                                    "Logic": 0,
                                    "Items": [
                                        {
                                            "Key": "Expert",
                                            "Title": "",
                                            "Logic": 0,
                                            "Field": "EXPERT",
                                            "Operator": 0,
                                            "Value": search_exp,
                                            "Value2": "",
                                        }
                                    ],
                                    "ChildItems": [],
                                },
                                {
                                    "Key": "ControlGroup",
                                    "Title": "",
                                    "Logic": 0,
                                    "Items": [],
                                    "ChildItems": [],
                                }
                            ]
                        },
                        "ExScope": "1",
                        "SearchType": 4,
                        "Rlang": "CHINESE",
                        "KuaKuCode": self.kuaku_code,  # 关键：指定资源分类
                        "SearchFrom": 1,
                    },
                    "pageNum": "1",
                    "pageSize": "20",
                    "sortField": "",
                    "sortType": "",
                    "dstyle": "listmode",
                    "productStr": self.product_str,
                    "aside": f"({search_exp_aside})",
                    "searchFrom": "资源范围：总库;++中英文扩展;++时间范围：更新时间：不限;++",
                    "CurPage": "1",
                }
            else:
                url = "https://chn.oversea.cnki.net/kns/Brief/GetGridTableHtml"
                query_json = {
                    "IsSearch": "true",
                    "QueryJson": {
                        "Platform": "",
                        "DBCode": "CFLS",
                        "KuaKuCode": "CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFN",
                        "QNode": {
                            "QGroup": [
                                {
                                    "Key": "Subject",
                                    "Title": "",
                                    "Logic": 4,
                                    "Items": [
                                        {
                                            "Key": "Expert",
                                            "Title": "",
                                            "Logic": 0,
                                            "Name": "",
                                            "Operate": "",
                                            "Value": search_exp,
                                            "ExtendType": 12,
                                            "ExtendValue": "中英文对照",
                                            "Value2": "",
                                            "BlurType": "",
                                        }
                                    ],
                                    "ChildItems": [],
                                }
                            ]
                        },
                        "ExScope": 1,
                        "CodeLang": "",
                    },
                    "PageName": "AdvSearch",
                    "DBCode": "CFLS",
                    "KuaKuCodes": "CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFN",
                    "CurPage": "1",
                    "RecordsCntPerPage": "20",
                    "CurDisplayMode": "listmode",
                }

            # 编码请求数据（处理嵌套JSON）
            encoded_data = {}
            for key, value in query_json.items():
                if isinstance(value, dict):
                    encoded_data[key] = json.dumps(value, ensure_ascii=False)
                else:
                    encoded_data[key] = value

            # 发送搜索请求
            response = requests.post(
                url,
                headers=self.cnki_headers,
                data=encoded_data,
                timeout=15
            )
            response.raise_for_status()

            # 解析搜索结果
            soup = BeautifulSoup(response.text, "html.parser")
            # 检测错误提示
            error_elem = soup.select_one("#briefBox .no-content")
            if error_elem:
                print(f"CNKI搜索错误: {error_elem.get_text(strip=True)}")
                return []

            results = []
            # 适配CNKI结果表格结构
            for row in soup.select("table.result-table-list"):
                title_elem = row.select_one("td.name a")
                if not title_elem:
                    continue

                author_links = row.select("td.author a")  # 匹配所有作者<a>标签
                authors = ", ".join([a.get_text(strip=True) for a in author_links]) if author_links else ""

                results.append({
                    "title": row.select_one("td.name a").get_text(strip=True) or "",
                    "url": row.select_one("td.name a").get("href", ""),
                    "authors": authors,
                    "source": row.select_one("td.source").get_text(strip=True) or "",
                    "date": row.select_one("td.date").get_text(strip=True) or "",
                })
            return results

        except Exception as e:
            print(f"CNKI搜索错误: {e}")
            return []

    def extract_metadata(self, title) -> Optional[Dict]:
        """提取PDF的中文文献元数据"""
        cnki_results = self.search_cnki(title)
        if not cnki_results:
            print("CNKI未找到匹配结果")
            return None
        best_match = cnki_results[0]
        return {
            "title": best_match.get("title"),
            "author": ', '.join([auth.strip() for auth in best_match.get("authors").split(';') if auth.strip()]),
            "journal": best_match.get("source"),
            "publication_date": best_match.get("date"),
            "year": best_match.get("date").split('-')[0] if best_match.get("date") else "",
            "url": best_match.get("url"),
            "original_title": title
        }


def pdf2bibtex(file):
    if isinstance(file, str):
        result = None
        if file.startswith('http'):
            try:
                response = requests.get(file, timeout=30)
                if response.status_code == 200:
                    pdf_bytes = response.content
                    if pdf_bytes.startswith(b'%PDF-'):
                        pdf_file = NamedBytesIO(pdf_bytes, name="temp.pdf")
                        print('file downloaded')
                        result = pdf2bibtex(pdf_file)
            except:
                result = None
        else:
            with open(file, 'rb') as f:
                result = pdf2bibtex(f)
        return result
    else:
        result = __find_doi(file)
        if "cnki" in result['identifier']:
            title = extract_cnki_title_from_dxdoiorg(result['identifier'])
            if title:
                result["metadata"] = ChineseMetadataExtractor().extract_metadata(title)
                result['bibtex'] = bibtex_makers.make_bibtex(result["metadata"])
            else:
                result['metadata'] = None
                result['bibtex'] = None
        else:
            if result["identifier_type"] == "arxiv ID":
                metadata = bibtex_makers.parse_bib_from_exportarxivorg(
                    result["validation_info"]
                )
            elif result["identifier_type"] == "arxiv DOI":
                if "arxiv_doi" not in result["validation_info"]:
                    result["validation_info"]["arxiv_doi"] = result["identifier"]
                metadata = bibtex_makers.parse_bib_from_exportarxivorg(
                    result["validation_info"]
                )
            elif result['identifier_type'] == 'DOI':
                metadata = bibtex_makers.parse_bib_from_dxdoiorg(result['validation_info'],
                                                                 method=pdf2doi.config.get('method_dxdoiorg'))

            if metadata:  # if retrieval of bibtex data was succesful, we add the fields to the result dictionary
                result['metadata'] = metadata
                result['bibtex'] = bibtex_makers.make_bibtex(metadata)
                result['metadata']['author'] = ', '.join([author['given'] + ' ' + author['family'] for author in metadata['author']])
            else:
                result['metadata'] = None
                result['bibtex'] = None
        if not result.get('metadata'):
            return {}
        return {
            "title": result['metadata'].get('title'),
            "authors": result['metadata'].get('author'),
            "url": result['metadata'].get('url'),
            "pub_year": result['metadata'].get('year'),
            "bibtex": result.get('bibtex'),
        }


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print(json.dumps({}))
        raise SystemExit(0)
    try:
        print(json.dumps(pdf2bibtex(sys.argv[1]) or {}, ensure_ascii=False))
    except Exception:
        print(json.dumps({}))
