from fastapi import FastAPI, Request, Response
import uvicorn
import json

app = FastAPI()

@app.api_route("/echo", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def echo(request: Request):
    body = await request.body()
    res = {
        "method": request.method,
        "headers": dict(request.headers),
        "cookies": request.cookies,
        "query": dict(request.query_params),
        "body": body.decode("utf-8", errors="ignore")
    }
    response = Response(content=json.dumps(res), media_type="application/json")
    response.set_cookie(key="dummy_session", value="abc123xyz")
    return response

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
