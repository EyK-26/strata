import React, { useState, useContext } from "react";
import Context from "../../context/Context";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function Login({ loadUserStatus }) {
    const { state, dispatch } = useContext(Context);
    const [values, setValues] = useState({
        email: "",
        password: "",
    });
    const navigate = useNavigate();

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            const response = await axios.post("/login", values);
            loadUserStatus();
            navigate("/");
        } catch (error) {
            dispatch({
                type: "error/add",
                payload: error.response.data.errors,
            });
        }
    };

    const handleChange = (event) => {
        setValues((previous_values) => {
            return {
                ...previous_values,
                [event.target.name]: event.target.value,
            };
        });
    };

    return (
        <div className="container">
            <div className="Login">
                <h1>Welcome To HiroApp</h1>
                <small>Hire someone, make a change!</small>
                <form action="/login" method="post" onSubmit={handleSubmit}>
                    <label htmlFor="email">
                        Email
                        <input
                            type="email"
                            name="email"
                            value={values.email}
                            onChange={handleChange}
                        />
                    </label>
                    <label htmlFor="password">
                        Password
                        <input
                            type="password"
                            name="password"
                            value={values.password}
                            onChange={handleChange}
                        />
                    </label>
                    <button>Login</button>
                </form>
            </div>
            <div className="errors">
                {state.errors?.email && <span>{state.errors?.email}</span>}
                {state.errors?.password && (
                    <span>{state.errors?.password}</span>
                )}
            </div>
        </div>
    );
}
