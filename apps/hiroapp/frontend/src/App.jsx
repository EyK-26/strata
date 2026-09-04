import React, { useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Context from "./context/Context";
import Router from "./router/Router";
import axios from "axios";

const App = () => {
    const { state, dispatch } = useContext(Context);
    const navigate = useNavigate();

    const loadUserStatus = async () => {
        try {
            const response = await axios.get("/api/user");
            if (Math.floor(response.status / 100) === 2) {
                dispatch({
                    type: "user/set",
                    payload: response.data,
                });
            } else if (response.status === 401) {
                dispatch({
                    type: "user/set",
                    payload: false,
                });
                navigate("/login");
            }
        } catch (error) {
            dispatch({
                type: "user/set",
                payload: null,
            });
            navigate("/login");
        }
    };

    useEffect(() => {
        if (state.user === null) {
            loadUserStatus();
        }
    }, [state.user]);

    return <Router loadUserStatus={loadUserStatus} />;
};
export default App;
