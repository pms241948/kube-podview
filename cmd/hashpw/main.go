// hashpw는 로컬 로그인용 bcrypt 해시를 생성한다.
//
//	go run ./cmd/hashpw
//	비밀번호 입력: ****
//	$2a$10$...
//
// 출력된 해시를 LOCAL_USERS="사용자명:해시" 형태로 사용한다.
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	var password string
	if len(os.Args) > 1 {
		password = os.Args[1]
	} else {
		fmt.Fprint(os.Stderr, "비밀번호 입력: ")
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil {
			fmt.Fprintln(os.Stderr, "입력 읽기 실패:", err)
			os.Exit(1)
		}
		password = strings.TrimRight(line, "\r\n")
	}
	if password == "" {
		fmt.Fprintln(os.Stderr, "비밀번호가 비어 있습니다")
		os.Exit(1)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintln(os.Stderr, "해시 생성 실패:", err)
		os.Exit(1)
	}
	fmt.Println(string(hash))
}
