source ./helpers.sh

greet() {
  echo "hello $1"
}

NAME="alice"
greet "$NAME"
