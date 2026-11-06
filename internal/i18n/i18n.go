// Package i18n는 사용자에게 보이는 서버 메시지의 언어를 고른다.
//
// 웹 UI는 선택한 언어를 모든 API 요청의 Accept-Language 헤더("en" 또는 "ko")로 보낸다.
// 게이트웨이 프록시는 헤더를 그대로 전달하므로 원격 클러스터의 응답도 같은 언어가 된다.
// 헤더가 없거나 다른 언어면 영어(기본값)를 쓴다. 운영자용 로그·기동 오류는 대상이 아니다.
package i18n

import (
	"fmt"
	"net/http"
	"strings"
)

type Lang string

const (
	EN Lang = "en"
	KO Lang = "ko"
)

// FromRequest는 Accept-Language의 첫 번째 언어만 본다 ("ko", "ko-KR,ko;q=0.9,..." → KO).
func FromRequest(r *http.Request) Lang {
	first, _, _ := strings.Cut(r.Header.Get("Accept-Language"), ",")
	first, _, _ = strings.Cut(first, ";")
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(first)), "ko") {
		return KO
	}
	return EN
}

// Pick은 언어에 맞는 문구를 고른다.
func Pick(l Lang, en, ko string) string {
	if l == KO {
		return ko
	}
	return en
}

// T는 요청 언어에 맞는 문구를 고른다.
func T(r *http.Request, en, ko string) string {
	return Pick(FromRequest(r), en, ko)
}

// Errorf는 요청 언어에 맞는 형식 문자열로 오류를 만든다. 두 형식의 인자 순서는 같아야 한다.
func Errorf(r *http.Request, en, ko string, args ...any) error {
	return fmt.Errorf(T(r, en, ko), args...)
}
