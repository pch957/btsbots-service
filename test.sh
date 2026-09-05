
#### 1. 删除本地的 Tag：
git tag -d v0.0.1

#### 2. 删除远程（GitHub）上的 Tag：
git push origin :refs/tags/v0.0.1
# *(或者使用简写：`git push origin --delete v0.0.1`)*

#### 3. 重新打 Tag 并推送：
# 确保你已经把上面的 .github/workflows/build.yml 提交到了本地仓库
git add .github *
git commit -m "feat: add GitHub Actions workflow for multi-platform build"
git push origin main

# 重新创建并推送 tag
git tag v0.0.1
git push origin v0.0.1
