import java.util.ArrayList;

class UserService {
    UserService() {}

    void greet(String user) {
        System.out.println(user);
    }

    static UserService create() {
        ArrayList<String> items = new ArrayList<>();
        items.add("hi");
        return new UserService();
    }
}
