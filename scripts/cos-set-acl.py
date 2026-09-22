#!/usr/bin/env python3
"""查看 / 修改 COS 桶的读写权限（源站防直连用）。

为什么需要它：站点是 CDN 回源到 COS，但桶若是「公有读」，任何人都能直接访问
`<bucket>.cos.<region>.myqcloud.com` 绕过 CDN 下载，产生单价更高的 COS「外网下行流量」
（2026-09-22 实测每天约 110–185 MB 就是这么来的）。**治本做法**是：

  1) 先在 CDN 侧开启「回源鉴权」（控制台：CDN → 域名管理 → 访问控制 → 回源鉴权），
     让回源请求带上鉴权参数/头部；
  2) 确认站点仍正常（本脚本的 --verify 会同时探 CDN 与源站）；
  3) 再把桶切成私有读（`--private --yes`）。

顺序不能反：先切私有读会让 CDN 回源被拒，全站 403。

用法：
  python3 scripts/cos-set-acl.py                      # 只看当前权限（默认动作，不改动）
  python3 scripts/cos-set-acl.py --verify             # 顺便探 CDN 与源站的响应码
  python3 scripts/cos-set-acl.py --private --yes      # 切成私有读（危险：确认已配回源鉴权）
  python3 scripts/cos-set-acl.py --public-read --yes  # 回滚成公有读

密钥从 .tools/cos.yaml（或 ~/.cos.yaml，可 --config 指定）读取，不会打印出来。
"""
import argparse, hashlib, hmac, os, re, sys, time, urllib.error, urllib.request

PUBLIC_GROUP = "AllUsers"


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


def get_acl(sid, skey, host):
    params = {"acl": ""}
    headers = {"host": host}
    req = urllib.request.Request("https://" + host + "/?acl", method="GET")
    req.add_header("Authorization", sign(sid, skey, "GET", "/", params, headers))
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        print("读取 ACL 失败 HTTP", e.code)
        print(e.read().decode("utf-8", "replace")[:500])
        sys.exit(1)


def put_acl(sid, skey, host, acl):
    params = {"acl": ""}
    headers = {"host": host, "x-cos-acl": acl}
    req = urllib.request.Request("https://" + host + "/?acl", data=b"", method="PUT")
    req.add_header("Authorization", sign(sid, skey, "PUT", "/", params, headers))
    req.add_header("x-cos-acl", acl)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print("已设置为 " + acl + "：HTTP", resp.status)
    except urllib.error.HTTPError as e:
        print("设置失败 HTTP", e.code)
        print(e.read().decode("utf-8", "replace")[:500])
        sys.exit(1)


def probe(url, label):
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "devkit-acl-check"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            print("    %-46s HTTP %s %s" % (label, resp.status, resp.headers.get("Content-Type", "")))
            return resp.status
    except urllib.error.HTTPError as e:
        print("    %-46s HTTP %s" % (label, e.code))
        return e.code
    except Exception as e:
        print("    %-46s 请求失败：%s" % (label, e))
        return 0


def summarize(xml):
    anon = "READ" if PUBLIC_GROUP in xml else "—"
    print("    匿名（AllUsers）读权限：" + ("有 —— 任何人都能绕过 CDN 直连下载" if anon == "READ" else "无"))
    for m in re.finditer(r"<Grant>.*?</Grant>", xml, re.S):
        g = m.group(0)
        who = (re.search(r"<ID>(.*?)</ID>", g) or [None, "?"])[1] if "<ID>" in g else PUBLIC_GROUP
        perm = (re.search(r"<Permission>(.*?)</Permission>", g) or [None, "?"])[1]
        print("    Grant: %-28s %s" % (who, perm))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只读查看（默认动作）")
    ap.add_argument("--private", action="store_true", help="设为私有读（需 --yes）")
    ap.add_argument("--public-read", action="store_true", help="设为公有读（需 --yes，用于回滚）")
    ap.add_argument("--verify", action="store_true", help="额外探测 CDN 与源站的响应码")
    ap.add_argument("--yes", action="store_true", help="确认执行危险操作")
    ap.add_argument("--config", default="")
    args = ap.parse_args()

    if args.private and args.public_read:
        sys.exit("--private 与 --public-read 不能同时给")
    conf = args.config or (".tools/cos.yaml" if os.path.exists(".tools/cos.yaml")
                           else os.path.expanduser("~/.cos.yaml"))
    sid, skey, bucket, region = load_conf(conf)
    host = bucket + ".cos." + region + ".myqcloud.com"
    origin = "https://" + host + "/index.html"

    print("桶：" + bucket + "（" + region + "）/ 源站域名：" + host)
    print("当前 ACL：")
    summarize(get_acl(sid, skey, host))

    if args.private or args.public_read:
        target = "private" if args.private else "public-read"
        if not args.yes:
            print()
            print("将要把桶设为 " + target + "，但这会改变线上读权限。")
            print("确认 CDN 侧已开启回源鉴权后再执行：python3 scripts/cos-set-acl.py --" +
                  ("private" if args.private else "public-read") + " --yes")
            sys.exit(2)
        if args.private:
            print()
            print("⚠️  确认清单：① CDN 已开回源鉴权；② 下方 --verify 里 CDN 仍是 200；")
            print("    ③ 回滚命令随时可用：python3 scripts/cos-set-acl.py --public-read --yes")
        put_acl(sid, skey, host, target)
        print("复核 ACL：")
        summarize(get_acl(sid, skey, host))

    print("探测：")
    probe("https://www.t502.fun/", "CDN 首页（应 200）")
    probe(origin, "源站 index.html（私有读后应为 403）")
    if not args.verify:
        print("    （想看完整探测用 --verify，本行以下同样会执行上面的两条探针）")


if __name__ == "__main__":
    main()
