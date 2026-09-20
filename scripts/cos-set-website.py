#!/usr/bin/env python3
"""通过 COS API 配置静态网站（索引文档 / 错误文档），无需登录控制台。

用法：
  python3 scripts/cos-set-website.py                 # 索引 index.html，错误文档 404.html
  python3 scripts/cos-set-website.py --error 200.html
  python3 scripts/cos-set-website.py --index index.html --error 404.html --config .tools/cos.yaml

说明：coscli 没有静态网站子命令，这里按 COS 签名算法 v5（q-sign-algorithm=sha1）直接调 PUT Bucket website。
密钥从 coscli 配置文件读取（默认 .tools/cos.yaml，其次 ~/.cos.yaml），不会打印到输出。
"""
import argparse, hashlib, hmac, os, re, sys, time, urllib.error, urllib.request


def load_conf(path):
    text = open(path, encoding="utf-8").read()
    def pick(key):
        m = re.search(key + r":\s*(\S+)", text)
        if not m:
            sys.exit("配置缺少 " + key + "：" + path)
        return m.group(1)
    return pick("secretid"), pick("secretkey"), pick("name"), pick("region")


def sign(sid, skey, method, path, params, headers):
    now = int(time.time())
    key_time = str(now) + ";" + str(now + 3600)
    sign_key = hmac.new(skey.encode(), key_time.encode(), hashlib.sha1).hexdigest()
    param_list = "&".join(k + "=" + v for k, v in sorted(params.items()))
    header_list = "&".join(k + "=" + v for k, v in sorted(headers.items()))
    http_string = method.lower() + chr(10) + path + chr(10) + param_list + chr(10) + header_list + chr(10)
    sha1_http = hashlib.sha1(http_string.encode()).hexdigest()
    string_to_sign = "sha1" + chr(10) + key_time + chr(10) + sha1_http + chr(10)
    sig = hmac.new(sign_key.encode(), string_to_sign.encode(), hashlib.sha1).hexdigest()
    return ("q-sign-algorithm=sha1&q-ak=" + sid + "&q-sign-time=" + key_time + "&q-key-time=" + key_time
            + "&q-header-list=" + ",".join(sorted(headers))
            + "&q-url-param-list=" + ",".join(sorted(params))
            + "&q-signature=" + sig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", default="index.html")
    ap.add_argument("--error", default="404.html")
    ap.add_argument("--config", default="")
    args = ap.parse_args()

    conf = args.config or (".tools/cos.yaml" if os.path.exists(".tools/cos.yaml")
                           else os.path.expanduser("~/.cos.yaml"))
    sid, skey, bucket, region = load_conf(conf)
    host = bucket + ".cos." + region + ".myqcloud.com"
    params = {"website": ""}
    headers = {"host": host}

    body = ("<WebsiteConfiguration><IndexDocument><Suffix>" + args.index + "</Suffix></IndexDocument>"
            "<ErrorDocument><Key>" + args.error + "</Key></ErrorDocument></WebsiteConfiguration>").encode()
    req = urllib.request.Request("https://" + host + "/?website", data=body, method="PUT")
    req.add_header("Authorization", sign(sid, skey, "PUT", "/", params, headers))
    req.add_header("Content-Type", "application/xml")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print("已设置静态网站：索引文档 =", args.index, "| 错误文档 =", args.error, "| HTTP", resp.status)
    except urllib.error.HTTPError as e:
        print("设置失败 HTTP", e.code)
        print(e.read().decode("utf-8", "replace")[:500])
        sys.exit(1)

    req2 = urllib.request.Request("https://" + host + "/?website", method="GET")
    req2.add_header("Authorization", sign(sid, skey, "GET", "/", params, headers))
    with urllib.request.urlopen(req2, timeout=30) as resp:
        print(resp.read().decode("utf-8", "replace").strip())
    print("验证：" + "http://" + bucket + ".cos-website." + region + ".myqcloud.com/ 与 /不存在的路径")


if __name__ == "__main__":
    main()