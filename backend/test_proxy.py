import httpx
import asyncio
import json

async def run_tests():
    proxy_url = "http://127.0.0.1:8000/api/proxy"
    target_url = "http://127.0.0.1:8001/echo"
    
    methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    
    async with httpx.AsyncClient() as client:
        for method in methods:
            print(f"Testing method: {method}")
            req_data = {
                "method": method,
                "url": target_url,
                "headers": {"X-Test-Header": f"Value-{method}", "Cookie": "Test-Cookie=12345"},
                "body": json.dumps({"test_key": f"test_val_{method}"}) if method not in ["GET", "HEAD", "OPTIONS"] else None
            }
            
            # Send request through the proxy
            try:
                res = await client.post(proxy_url, json=req_data)
                res_data = res.json()
                
                if res.status_code != 200:
                    print(f"[{method}] Proxy failed with status {res.status_code}")
                    print(res.text)
                    continue
                    
                print(f"[{method}] Proxy responded OK.")
                if method != "HEAD":
                    echoed = res_data["body"]
                    if isinstance(echoed, str):
                        try:
                            echoed = json.loads(echoed)
                        except:
                            pass
                    
                    if isinstance(echoed, dict):
                        print(f"  Echoed Method: {echoed.get('method')}")
                        print(f"  Echoed Headers: {echoed.get('headers')}")
                        print(f"  Echoed Body: {echoed.get('body')}")
                        print(f"  Echoed Cookies: {echoed.get('cookies')}")
                    else:
                        print(f"  Raw Body: {echoed}")
                    
                print(f"  Set-Cookies returned by proxy: {res_data.get('set_cookies')}")
                print("-" * 40)
            except Exception as e:
                print(f"[{method}] Exception: {e}")

if __name__ == "__main__":
    asyncio.run(run_tests())
