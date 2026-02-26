require "json"

class UserService
  def greet(user)
    puts user
  end
end

make_service = ->(name) { UserService.new }
service = make_service.call("alice")
service.greet("alice")
