import axios from "axios";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const CreateUser = () => {
    const navigate = useNavigate();
    const [positions, setPositions] = useState(null);
    const [departments, setDepartments] = useState(null);
    const [values, setValues] = useState({
        first_name: "",
        last_name: "",
        department_id: "",
        position_id: "",
        role_id: "",
    });

    const fetchPositions = async () => {
        try {
            const response = await axios.get(
                "/api/positions-dep/" + values.department_id
            );
            setPositions(response.data);
        } catch (error) {
            console.log(error.response.data);
        }
    };

    const fetchDepartments = async () => {
        try {
            const response = await axios.get("/api/departments");
            setDepartments(response.data);
        } catch (error) {
            console.log(error.response.data);
        }
    };

    const handleSubmit = async (ev) => {
        ev.preventDefault();
        try {
            const response = await axios.post("/api/users", values);
            navigate("/users/" + response.data.id);
        } catch (error) {
            console.log(error);
        }
    };

    const handleChange = (ev) => {
        setValues((previous_values) => {
            return {
                ...previous_values,
                [ev.target.name]: ev.target.value,
            };
        });
    };

    useEffect(() => {
        fetchDepartments();
    }, []);

    useEffect(() => {
        if (values.department_id) {
            fetchPositions();
        }
    }, [values.department_id]);

    return (
        <div className="CreateUser">
            <h2>Create new user</h2>
            <form onSubmit={handleSubmit}>
                <label>
                    First name:
                    <input
                        type="text"
                        name="first_name"
                        onChange={handleChange}
                        value={values.first_name}
                        required
                    />
                </label>

                <label>
                    Last name:
                    <input
                        type="text"
                        name="last_name"
                        onChange={handleChange}
                        value={values.last_name}
                        required
                    />
                </label>

                <label>
                    Department:
                    <select
                        name="department_id"
                        onChange={handleChange}
                        value={values.department_id}
                        required
                    >
                        <option value="" disabled>
                            Select department
                        </option>
                        {departments
                            ? departments.map((department) => (
                                  <option
                                      key={department.id}
                                      value={department.id}
                                  >
                                      {department.name}
                                  </option>
                              ))
                            : "Loading positions..."}
                    </select>
                </label>

                <label>
                    Position:
                    <select
                        name="position_id"
                        onChange={handleChange}
                        value={values.position_id}
                        required
                    >
                        <option value="" disabled>
                            {values.department_id
                                ? "Select position"
                                : "Select department first"}
                        </option>
                        {positions
                            ? positions.map((position) => (
                                  <option
                                      key={position.name}
                                      value={position.id}
                                  >
                                      {position.name}
                                  </option>
                              ))
                            : "Loading positions..."}
                    </select>
                </label>

                <label>
                    Role:
                    <select
                        name="role_id"
                        onChange={handleChange}
                        value={values.role_id}
                        required
                    >
                        <option value="" disabled>
                            Select the role
                        </option>
                        <option value={1}>Admin</option>
                        <option value={2}>Candidate</option>
                        <option value={3}>Recruiter</option>
                    </select>
                </label>

                <button>Create</button>
            </form>
        </div>
    );
};

export default CreateUser;
