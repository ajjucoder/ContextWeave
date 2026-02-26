<?php

namespace App;

use App\Utils\Logger;

class UserService {
    public function greet(string $user): void {
        $this->helper();
        Logger::log($user);
    }

    private function helper(): int {
        return strlen("ok");
    }
}

$svc = new UserService();
$svc->greet("alice");
