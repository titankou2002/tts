<?php
/*
 * V43.1 Google 登入「整頁跳轉」的接收程式（手機主畫面全螢幕 App 模式用，一般瀏覽器用彈出視窗不會經過這裡）
 * Google 會把登入結果 (credential) 用 POST 送到這裡；先比對 Google 的防偽造碼 (g_csrf_token：cookie 與表單要一致)，
 * 再帶回原本的頁面，登入結果放在網址 # 後面 (不會送到任何伺服器)，由頁面交給系統後端向 Google 驗證。
 */
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

$allowed = array('DRIVER.html', 'OS.html', 'Analytics.html', 'approve.html');
$ret = isset($_COOKIE['tts_login_return']) ? $_COOKIE['tts_login_return'] : '';
$page = basename((string) parse_url($ret, PHP_URL_PATH));
if (!in_array($page, $allowed, true)) { $page = 'DRIVER.html'; }
$query = (string) parse_url($ret, PHP_URL_QUERY);
$query = $query !== '' ? '?' . preg_replace('/[^A-Za-z0-9_\-=&%.]/', '', $query) : '';
$back = '/tts/' . $page . $query;

$cred = isset($_POST['credential']) ? $_POST['credential'] : '';
$csrfBody = isset($_POST['g_csrf_token']) ? $_POST['g_csrf_token'] : '';
$csrfCookie = isset($_COOKIE['g_csrf_token']) ? $_COOKIE['g_csrf_token'] : '';

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || $cred === '' || $csrfBody === '' || $csrfCookie === ''
    || !hash_equals($csrfCookie, $csrfBody)
    || !preg_match('/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/', $cred)) {
  header('Location: ' . $back . '#gerr=1', true, 303);
  exit;
}
header('Location: ' . $back . '#gcred=' . $cred, true, 303);
exit;
