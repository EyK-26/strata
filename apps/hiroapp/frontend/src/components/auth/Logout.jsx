import React, { useContext } from "react";
import axios from "axios";
import Context from "../../context/Context";
import { useNavigate } from "react-router-dom";

export default function Logout() {
    const { dispatch } = useContext(Context);
    const navigate = useNavigate();

    const handleLogout = async (e) => {
        try {
            const response = await axios.post("/logout");
            dispatch({
                type: "user/set",
                payload: null,
            });
            navigate("/");
        } catch (error) {
            dispatch({
                type: "error/add",
                payload: error.response.data.errors,
            });
        }
    };

    return (
        <>
            <button onClick={handleLogout}>Logout</button>
        </>
    );
}
